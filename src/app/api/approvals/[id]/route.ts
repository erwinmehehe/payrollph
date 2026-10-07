import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, auditEvents, automationExecutions, leaveRequestIntervalSets, leaveRequests, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { canDecide } from "@/lib/delegation";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertMembership } from "@/lib/access";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { isPublicDemoIdentity } from "@/lib/demo-security";
import { resumeAutomationExecutionFromApproval, runAutomationEventSafely } from "@/lib/automation";
import { markTimesheetsStaleForEmployeeRange } from "@/lib/workforce-timesheet-server";
import { advanceApprovalChainAfterDecision } from "@/lib/approval-chains";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

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
  const sharedDemo = isPublicDemoIdentity(sessionUser.email);
  const deniedOrg = await assertMembership(sessionUser.id, task.organizationId);
  if (deniedOrg) return deniedOrg;
  const actor = sessionUser.name;

  const payrollRunMatch = task.detail.match(/Payroll run #(\d+)/);
  const payrollRunId = payrollRunMatch ? Number(payrollRunMatch[1]) : null;
  let payrollSubmission: { actor: string; metadata: Record<string, unknown> } | null = null;

  if (payrollRunId) {
    const [payrollRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, payrollRunId)).limit(1);
    if (!payrollRun || payrollRun.organizationId !== task.organizationId) {
      return Response.json({ error: "The payroll approval is not linked to a valid run in this workspace." }, { status: 409 });
    }
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
      const blockers = assuranceResult?.assurance.findings.filter(
        (finding) => finding.blocking && !(sharedDemo && finding.code === "MISSING_BANK_DETAILS"),
      ) ?? [];
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
          deciderUserId: sessionUser.id,
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

  const chain = await advanceApprovalChainAfterDecision({
    taskId,
    decision: status,
    decidedBy: actor,
  });

  let automationGate: unknown = null;
  try {
    if (chain.isChain && !chain.final && chain.nextTaskId) {
      await db.update(automationExecutions).set({
        waitingApprovalTaskId: chain.nextTaskId,
        updatedAt: new Date(),
      }).where(and(
        eq(automationExecutions.waitingApprovalTaskId, taskId),
        eq(automationExecutions.status, "waiting_approval"),
      ));
      automationGate = {
        status: "waiting_approval",
        approvalChainInstanceId: chain.instanceId,
        nextApprovalTaskId: chain.nextTaskId,
      };
    } else {
      automationGate = await resumeAutomationExecutionFromApproval({
        approvalTaskId: taskId,
        decision: status,
        decidedBy: actor,
      });
    }
  } catch (error) {
    automationGate = {
      status: "engine_error",
      error: error instanceof Error ? error.message.slice(0, 4000) : "Automation approval resume failed.",
    };
  }

  const deliveries = sharedDemo ? [] : await dispatchWebhook({
    organizationId: task.organizationId,
    event: "approval.decided",
    data: { taskId, title: task.title, status, decidedBy: actor, onBehalfOf: onBehalf },
  });

  const [linkedLeave] = await db.select().from(leaveRequests).where(eq(leaveRequests.approvalTaskId, taskId)).limit(1);
  const [linkedIntervalSet] = linkedLeave
    ? await db.select().from(leaveRequestIntervalSets).where(and(
        eq(leaveRequestIntervalSets.organizationId, task.organizationId),
        eq(leaveRequestIntervalSets.leaveRequestId, linkedLeave.id),
        eq(leaveRequestIntervalSets.status, "current"),
      )).limit(1)
    : [];
  const intervalRevision = linkedIntervalSet?.revision ?? null;
  const automation = [];
  let leaveStaleTimesheetIds: number[] = [];
  if (linkedLeave) {
    await db.update(leaveRequests).set({
      status,
      decidedBy: actor,
    }).where(eq(leaveRequests.id, linkedLeave.id));
    if (status === "Approved") {
      const staleTimesheets = await markTimesheetsStaleForEmployeeRange({
        organizationId: task.organizationId,
        employeeId: linkedLeave.employeeId,
        startDate: String(linkedLeave.startDate),
        endDate: String(linkedLeave.endDate),
      });
      leaveStaleTimesheetIds = staleTimesheets.map((row) => row.id);

      automation.push(...await runAutomationEventSafely({
        organizationId: task.organizationId,
        employeeId: linkedLeave.employeeId,
        trigger: "leave.approved",
        eventKey: `leave-approved:${linkedLeave.id}:${taskId}`,
        context: {
          leaveId: linkedLeave.id,
          leaveType: linkedLeave.leaveType,
          leaveDays: Number(linkedLeave.days),
          eventAmount: Number(linkedLeave.days),
          startDate: linkedLeave.startDate,
          endDate: linkedLeave.endDate,
          approvalTaskId: taskId,
          intervalRevision,
          intervalSetId: linkedIntervalSet?.id ?? null,
          staleTimesheetIds: leaveStaleTimesheetIds,
        },
      }));
      if (!sharedDemo) {
        await dispatchWebhook({
          organizationId: task.organizationId,
          event: "leave.approved",
          data: { leaveId: linkedLeave.id, employeeId: linkedLeave.employeeId, leaveType: linkedLeave.leaveType, days: linkedLeave.days },
        });
      }
    }
  }

  if (payrollRunId && status === "Approved") {
    const [approvedRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, payrollRunId)).limit(1);
    if (approvedRun) {
      automation.push(...await runAutomationEventSafely({
        organizationId: task.organizationId,
        trigger: "payroll.approved",
        eventKey: `payroll-approved:${payrollRunId}:${taskId}`,
        context: {
          payrollRunId,
          periodLabel: approvedRun.periodLabel,
          orgUnitId: approvedRun.scopeOrgUnitId,
          legalEntityId: approvedRun.legalEntityId,
          payrollAmount: Number(approvedRun.grossPay),
          netPay: Number(approvedRun.netPay),
          approvalTaskId: taskId,
          approvedBy: actor,
        },
      }));
    }
  }

  return Response.json({
    ...updated,
    delegation: decision,
    webhookDeliveries: deliveries.length,
    leaveUpdated: Boolean(linkedLeave),
    intervalRevision,
    leaveStaleTimesheetIds,
    automation,
    automationGate,
    approvalChain: chain,
  });
}
