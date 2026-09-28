import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, auditEvents, leaveRequests, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { canDecide } from "@/lib/delegation";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertMembership } from "@/lib/access";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";

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

  const payrollRunMatch = task.detail.match(/Payroll run #(\d+)/);
  const payrollRunId = payrollRunMatch ? Number(payrollRunMatch[1]) : null;

  if (payrollRunId && status === "Approved") {
    const assuranceResult = await buildPayrollAssurance(payrollRunId);
    const blockers = assuranceResult?.assurance.findings.filter((finding) => finding.blocking) ?? [];
    if (blockers.length > 0) {
      return Response.json({
        error: `Payroll assurance found ${blockers.length} blocking issue(s). Resolve them before approval.`,
        blockingFindings: blockers,
      }, { status: 409 });
    }

    const events = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, task.organizationId));
    const submission = events.find((event) => {
      if (event.action !== "Payroll submitted for review") return false;
      if (!event.metadata || typeof event.metadata !== "object") return false;
      return Number((event.metadata as Record<string, unknown>).runId) === payrollRunId;
    });
    if (submission && submission.actor.toLowerCase() === actor.toLowerCase()) {
      return Response.json({
        error: "Maker-checker control: the person who submitted this payroll cannot approve it.",
        maker: submission.actor,
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

  if (payrollRunId) {
    await db.update(payrollRuns)
      .set({ status: status === "Approved" ? "Ready for release" : "Needs review" })
      .where(eq(payrollRuns.id, payrollRunId));
  }

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
      payrollRunId,
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
