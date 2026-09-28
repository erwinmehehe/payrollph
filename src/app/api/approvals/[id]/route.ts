import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, auditEvents, leaveRequests } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { canDecide } from "@/lib/delegation";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertMembership } from "@/lib/access";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  const body = await request.json().catch(() => ({}));
  const status = body.status === "Approved" || body.status === "Declined" ? body.status : null;

  if (!Number.isInteger(taskId) || !status) {
    return Response.json({ error: "A valid task and decision are required." }, { status: 400 });
  }

  const [task] = await db.select().from(approvalTasks).where(eq(approvalTasks.id, taskId));
  if (!task) return Response.json({ error: "Approval task not found." }, { status: 404 });
  if (task.status !== "Pending") {
    return Response.json({ error: `This task was already ${task.status.toLowerCase()}.` }, { status: 409 });
  }

  const sessionUser = await getSessionUser();
  if (!sessionUser) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertMembership(sessionUser.id, task.organizationId);
  if (deniedOrg) return deniedOrg;
  const actor = sessionUser.name;

  if (task.title.startsWith("Payroll approval · ")) {
    const periodLabel = task.title.slice("Payroll approval · ".length).trim();
    const [submission] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, task.organizationId),
          eq(auditEvents.action, "Payroll submitted for approval"),
          eq(auditEvents.resource, periodLabel),
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    if (submission?.actor?.toLowerCase() === actor.toLowerCase()) {
      return Response.json({
        error: "Maker-checker control: the person who submitted this payroll cannot approve it.",
      }, { status: 403 });
    }
  }

  const decision = await canDecide(task.organizationId, task.approver, actor);
  if (!decision.permitted) {
    return Response.json({
      error: `${actor} is not the assigned approver and holds no active delegation for ${task.approver}.`,
      assignedApprover: task.approver,
      effectiveApprover: decision.effectiveApprover,
    }, { status: 403 });
  }

  const onBehalf = actor.toLowerCase() !== task.approver.toLowerCase() ? task.approver : null;

  const [updated] = await db.update(approvalTasks)
    .set({
      status,
      decidedBy: actor,
      decidedOnBehalfOf: onBehalf,
      decidedAt: new Date(),
    })
    .where(eq(approvalTasks.id, taskId))
    .returning();

  await recordAuditEvent({
    organizationId: task.organizationId,
    actor,
    action: onBehalf ? `Approval ${status.toLowerCase()} by delegate` : `Approval ${status.toLowerCase()}`,
    resource: task.title,
    metadata: {
      taskId,
      previousStatus: task.status,
      onBehalfOf: onBehalf,
      delegationChain: decision.chain,
      ruleVersion: "PH-2026.01",
    },
  });

  const deliveries = await dispatchWebhook({
    organizationId: task.organizationId,
    event: "approval.decided",
    data: { taskId, title: task.title, status, decidedBy: actor, onBehalfOf: onBehalf },
  });

  const [linkedLeave] = await db.select().from(leaveRequests).where(eq(leaveRequests.approvalTaskId, taskId)).limit(1);
  if (linkedLeave) {
    await db.update(leaveRequests).set({
      status,
      decidedBy: actor,
    }).where(eq(leaveRequests.id, linkedLeave.id));
    if (status === "Approved") {
      await dispatchWebhook({
        organizationId: task.organizationId,
        event: "leave.approved",
        data: { leaveId: linkedLeave.id, employeeId: linkedLeave.employeeId, leaveType: linkedLeave.leaveType, days: linkedLeave.days },
      });
    }
  }

  return Response.json({ ...updated, delegation: decision, webhookDeliveries: deliveries.length, leaveUpdated: Boolean(linkedLeave) });
}
