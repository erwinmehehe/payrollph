import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, auditEvents, leaveRequests, payrollRuns, userOrganizations, users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { canDecide } from "@/lib/delegation";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertMembership, PAYROLL_RELEASE_ROLES, roleAllowed } from "@/lib/access";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { queueMessageOnce } from "@/lib/mailer";

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
  let payrollSubmission: { actor: string; metadata: Record<string, unknown> } | null = null;
  let payrollRunForNotification: typeof payrollRuns.$inferSelect | null = null;
  let payrollMakerUserId: number | null = null;

  if (payrollRunId) {
    const [payrollRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, payrollRunId)).limit(1);
    if (!payrollRun || payrollRun.organizationId !== task.organizationId) {
      return Response.json({ error: "The payroll approval is not linked to a valid run in this workspace." }, { status: 409 });
    }
    payrollRunForNotification = payrollRun;

    if (payrollRun.status !== "Pending approval") {
      return Response.json({
        error: `This payroll is not awaiting approval (currently ${payrollRun.status}). Recalculate or submit it for review again.`,
      }, { status: 409 });
    }

    const events = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, task.organizationId));
    const submission = events.find((event) => {
      if (event.action !== "Payroll submitted for review") return false;
      if (!event.metadata || typeof event.metadata !== "object") return false;
      const metadata = event.metadata as Record<string, unknown>;
      return Number(metadata.taskId) === taskId && Number(metadata.runId) === payrollRunId;
    });

    if (!submission || !submission.metadata || typeof submission.metadata !== "object") {
      return Response.json({ error: "Payroll review submission audit record is missing; approval is blocked." }, { status: 409 });
    }

    const metadata = submission.metadata as Record<string, unknown>;
    payrollSubmission = { actor: submission.actor, metadata };
    const makerUserId = Number(metadata.makerUserId);
    const assignedApproverUserId = Number(metadata.approverUserId);
    payrollMakerUserId = Number.isInteger(makerUserId) ? makerUserId : null;

    if (Number.isInteger(makerUserId) && makerUserId === sessionUser.id) {
      return Response.json({
        error: "Maker-checker control: the person who submitted this payroll cannot approve it.",
        maker: submission.actor,
      }, { status: 403 });
    }

    if (
      actor.toLowerCase() === task.approver.toLowerCase() &&
      Number.isInteger(assignedApproverUserId) &&
      assignedApproverUserId !== sessionUser.id
    ) {
      return Response.json({ error: "This approval is assigned to a different authenticated user." }, { status: 403 });
    }

    if (status === "Approved") {
      const assuranceResult = await buildPayrollAssurance(payrollRunId);
      const blockers = assuranceResult?.assurance.findings.filter((finding) => finding.blocking) ?? [];
      if (blockers.length > 0) {
        return Response.json({
          error: `Payroll assurance found ${blockers.length} blocking issue(s). Resolve them before approval.`,
          blockingFindings: blockers,
        }, { status: 409 });
      }
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

  let updated;
  try {
    updated = await db.transaction(async (tx) => {
      // Payroll decisions claim the payroll state first. Recalculation uses the
      // same lock order, which avoids an approval/recalculation deadlock and
      // guarantees that only one concurrent decision can win.
      if (payrollRunId) {
        const [updatedRun] = await tx.update(payrollRuns)
          .set({ status: status === "Approved" ? "Ready for release" : "Needs review" })
          .where(and(
            eq(payrollRuns.id, payrollRunId),
            eq(payrollRuns.status, "Pending approval"),
          ))
          .returning();

        if (!updatedRun) {
          throw new Error("PAYROLL_APPROVAL_CONFLICT");
        }
      }

      const [updatedTask] = await tx.update(approvalTasks)
        .set({
          status,
          decidedBy: actor,
          decidedOnBehalfOf: onBehalf,
          decidedAt: new Date(),
        })
        .where(and(
          eq(approvalTasks.id, taskId),
          eq(approvalTasks.status, "Pending"),
        ))
        .returning();

      if (!updatedTask) {
        throw new Error("APPROVAL_TASK_CONFLICT");
      }

      await tx.insert(auditEvents).values({
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
          makerUserId: payrollSubmission ? Number(payrollSubmission.metadata.makerUserId) || null : null,
          approverUserId: payrollSubmission ? Number(payrollSubmission.metadata.approverUserId) || null : null,
        },
      });

      return updatedTask;
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message === "PAYROLL_APPROVAL_CONFLICT" ||
      error.message === "APPROVAL_TASK_CONFLICT"
    )) {
      return Response.json({
        error: "This approval changed while your decision was being saved. Refresh to see the current state.",
      }, { status: 409 });
    }
    throw error;
  }

  let handoffNotification:
    | { ok: boolean; recipients: number; duplicateCount: number; warning?: string }
    | null = null;

  if (payrollRunId && payrollRunForNotification) {
    try {
      if (status === "Approved") {
        const members = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: userOrganizations.role,
          })
          .from(userOrganizations)
          .innerJoin(users, eq(userOrganizations.userId, users.id))
          .where(eq(userOrganizations.organizationId, task.organizationId));

        const releaseAuthorities = members.filter((member) => roleAllowed(member.role, PAYROLL_RELEASE_ROLES));
        let okCount = 0;
        let duplicateCount = 0;
        let failedCount = 0;

        for (const recipient of releaseAuthorities) {
          const notice = await queueMessageOnce({
            organizationId: task.organizationId,
            recipient: recipient.email,
            subject: `Payroll ready for release: ${payrollRunForNotification.periodLabel}`,
            purpose: `payroll-release-${payrollRunId}-${recipient.id}`,
            body: [
              `Hi ${recipient.name},`,
              "",
              `${actor} approved ${payrollRunForNotification.periodLabel} payroll after independent review.`,
              "",
              "Sign in to Linaw and open Payroll to review the release checklist and release the run.",
              "Only an owner or administrator can complete release.",
            ].join("\n"),
          });
          if (notice.delivered || notice.queued) okCount += 1;
          else failedCount += 1;
          if (notice.duplicate) duplicateCount += 1;
        }

        handoffNotification = {
          ok: releaseAuthorities.length > 0 && okCount === releaseAuthorities.length,
          recipients: releaseAuthorities.length,
          duplicateCount,
          ...(releaseAuthorities.length === 0
            ? { warning: "Payroll was approved, but no owner/admin release authority has an email target in this workspace." }
            : failedCount > 0
              ? { warning: `Payroll was approved, but ${failedCount} release-authority notification(s) could not be queued.` }
              : {}),
        };
      } else if (payrollMakerUserId) {
        const [maker] = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, payrollMakerUserId))
          .limit(1);

        if (maker) {
          const notice = await queueMessageOnce({
            organizationId: task.organizationId,
            recipient: maker.email,
            subject: `Payroll returned for changes: ${payrollRunForNotification.periodLabel}`,
            purpose: `payroll-returned-${payrollRunId}-${maker.id}`,
            body: [
              `Hi ${maker.name},`,
              "",
              `${actor} declined ${payrollRunForNotification.periodLabel} payroll during independent review.`,
              "",
              "Sign in to Linaw and open Payroll to review the run, resolve the issue, recalculate if needed, and submit it again.",
            ].join("\n"),
          });
          handoffNotification = {
            ok: notice.delivered || notice.queued,
            recipients: 1,
            duplicateCount: notice.duplicate ? 1 : 0,
            ...(notice.reason ? { warning: notice.reason } : {}),
          };
        }
      }
    } catch {
      handoffNotification = {
        ok: false,
        recipients: 0,
        duplicateCount: 0,
        warning: status === "Approved"
          ? "Payroll was approved, but the release-authority notification could not be queued."
          : "Payroll was returned for changes, but the maker notification could not be queued.",
      };
    }
  }

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

  return Response.json({
    ...updated,
    delegation: decision,
    webhookDeliveries: deliveries.length,
    leaveUpdated: Boolean(linkedLeave),
    handoffNotification,
  });
}
