import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalChainInstances, approvalTasks, auditEvents, automationExecutions, leaveRequestIntervalSets, leaveRequests, payrollRuns, workforcePlanningScenarios, workforcePlans } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { canDecide } from "@/lib/delegation";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertMembership } from "@/lib/access";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { isPublicDemoIdentity } from "@/lib/demo-security";
import { resumeAutomationExecutionFromApproval, runAutomationEventSafely } from "@/lib/automation";
import { markTimesheetsStaleForEmployeeRange } from "@/lib/workforce-timesheet-server";
import { advanceApprovalChainAfterDecisionTx } from "@/lib/approval-chains";
import { verifyPayrollApprovalSnapshot } from "@/lib/payroll-approval-integrity";

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

  const legacyPayrollTask = !task.payrollRunId && task.detail.includes("Payroll run #");
  if (legacyPayrollTask) {
    return Response.json({
      error: "This legacy payroll approval is missing its structural payroll-run link. Resubmit the payroll for checker review so approval is bound to an exact payroll snapshot.",
    }, { status: 409 });
  }
  const payrollRunId = task.payrollRunId;
  let payrollSubmission: { actor: string; metadata: Record<string, unknown> } | null = null;
  let workforceScenarioApproval: {
    scenarioId: number;
    planId: number | null;
    name: string;
    version: number;
    snapshotHash: string;
    submittedByUserId: number | null;
    scopeOrgUnitId: number | null;
    worksiteId: number | null;
  } | null = null;

  if (task.approvalChainInstanceId) {
    const [instance] = await db.select().from(approvalChainInstances).where(and(
      eq(approvalChainInstances.id, task.approvalChainInstanceId),
      eq(approvalChainInstances.organizationId, task.organizationId),
    )).limit(1);
    if (instance?.sourceType === "workforce_plan_scenario") {
      const scenarioId = Number(instance.sourceKey);
      const [scenario] = Number.isInteger(scenarioId)
        ? await db.select().from(workforcePlanningScenarios).where(and(
            eq(workforcePlanningScenarios.id, scenarioId),
            eq(workforcePlanningScenarios.organizationId, task.organizationId),
          )).limit(1)
        : [];
      if (!scenario) {
        return Response.json({ error: "The workforce-plan approval is not linked to a valid staffing scenario." }, { status: 409 });
      }
      if (scenario.status !== "submitted") {
        return Response.json({
          error: `This staffing scenario is not awaiting approval (currently ${scenario.status}).`,
        }, { status: 409 });
      }
      if (scenario.submittedByUserId === sessionUser.id) {
        return Response.json({
          error: "Maker-checker control: the person who submitted this staffing scenario cannot approve any step of its business process.",
        }, { status: 403 });
      }
      workforceScenarioApproval = {
        scenarioId: scenario.id,
        planId: scenario.planId,
        name: scenario.name,
        version: scenario.version,
        snapshotHash: scenario.snapshotHash,
        submittedByUserId: scenario.submittedByUserId,
        scopeOrgUnitId: scenario.scopeOrgUnitId,
        worksiteId: scenario.worksiteId,
      };
    }
  }

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

    const snapshot = await verifyPayrollApprovalSnapshot(payrollRun, task);
    if (!snapshot.valid) {
      return Response.json({
        error: "Payroll contents changed after review submission, or this approval lacks a certified payroll snapshot. Recalculate/resubmit before approval.",
        code: "PAYROLL_APPROVAL_SNAPSHOT_STALE",
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

  const decision = await canDecide(task.organizationId, task.approver, actor, sessionUser.id);
  if (!decision.permitted) {
    return Response.json({
      error: `${actor} is not the assigned approver and holds no active delegation for ${task.approver}.`,
      assignedApprover: task.approver,
      effectiveApprover: decision.effectiveApprover,
    }, { status: 403 });
  }

  const onBehalf = decision.roleMatched ? null : actor.toLowerCase() !== task.approver.toLowerCase() ? task.approver : null;

  let updated;
  let workforcePlanDecision: { scenarioId: number; status: "approved" | "rejected" } | null = null;
  let chain: Awaited<ReturnType<typeof advanceApprovalChainAfterDecisionTx>> = {
    isChain: false,
    final: true,
    nextTaskId: null,
    instanceId: null,
  };
  try {
    const decisionResult = await db.transaction(async (tx) => {
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

      const chainResult = await advanceApprovalChainAfterDecisionTx(tx, {
        taskId,
        decision: status,
        decidedBy: actor,
      });

      if (chainResult.isChain && !chainResult.final && chainResult.nextTaskId) {
        await tx.update(automationExecutions).set({
          waitingApprovalTaskId: chainResult.nextTaskId,
          updatedAt: new Date(),
        }).where(and(
          eq(automationExecutions.waitingApprovalTaskId, taskId),
          eq(automationExecutions.status, "waiting_approval"),
        ));
      }

      let sourceDecision: { scenarioId: number; status: "approved" | "rejected" } | null = null;
      if (
        workforceScenarioApproval
        && chainResult.isChain
        && chainResult.final
        && (chainResult.status === "approved" || chainResult.status === "declined")
      ) {
        const nextScenarioStatus = chainResult.status === "approved" ? "approved" : "rejected";
        const [scenarioRow] = await tx.update(workforcePlanningScenarios).set({
          status: nextScenarioStatus,
          decidedByUserId: sessionUser.id,
          decidedAt: new Date(),
          decisionNote: `${nextScenarioStatus === "approved" ? "Approved" : "Rejected"} through approval-chain instance #${chainResult.instanceId}.`,
          updatedAt: new Date(),
        }).where(and(
          eq(workforcePlanningScenarios.id, workforceScenarioApproval.scenarioId),
          eq(workforcePlanningScenarios.status, "submitted"),
        )).returning();
        if (!scenarioRow) throw new Error("WORKFORCE_PLAN_APPROVAL_CONFLICT");

        if (
          scenarioRow.planId
          && scenarioRow.scopeOrgUnitId == null
          && scenarioRow.worksiteId == null
        ) {
          const [linkedPlan] = await tx.select({ status: workforcePlans.status }).from(workforcePlans)
            .where(eq(workforcePlans.id, scenarioRow.planId))
            .limit(1);
          if (linkedPlan && linkedPlan.status !== "published") {
            await tx.update(workforcePlans).set({
              status: nextScenarioStatus,
              updatedAt: new Date(),
            }).where(eq(workforcePlans.id, scenarioRow.planId));
          }
        }

        await tx.insert(auditEvents).values({
          organizationId: task.organizationId,
          actor,
          action: nextScenarioStatus === "approved"
            ? "Workforce staffing scenario approved"
            : "Workforce staffing scenario rejected",
          resource: `${workforceScenarioApproval.name} v${workforceScenarioApproval.version}`,
          metadata: {
            scenarioId: workforceScenarioApproval.scenarioId,
            planId: workforceScenarioApproval.planId,
            snapshotHash: workforceScenarioApproval.snapshotHash,
            submittedByUserId: workforceScenarioApproval.submittedByUserId,
            decidedByUserId: sessionUser.id,
            approvalChainInstanceId: chainResult.instanceId,
            approvalTaskId: taskId,
            approvalChainStatus: chainResult.status,
          },
        });
        sourceDecision = {
          scenarioId: workforceScenarioApproval.scenarioId,
          status: nextScenarioStatus,
        };
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
          approvalChainInstanceId: chainResult.instanceId,
          approvalChainFinal: chainResult.final,
          nextApprovalTaskId: chainResult.nextTaskId,
        },
      });

      return { updatedTask, chainResult, sourceDecision };
    });
    updated = decisionResult.updatedTask;
    chain = decisionResult.chainResult;
    workforcePlanDecision = decisionResult.sourceDecision;
  } catch (error) {
    if (error instanceof Error && (
      error.message === "PAYROLL_APPROVAL_CONFLICT" ||
      error.message === "APPROVAL_TASK_CONFLICT" ||
      error.message === "WORKFORCE_PLAN_APPROVAL_CONFLICT"
    )) {
      return Response.json({
        error: "This approval changed while your decision was being saved. Refresh to see the current state.",
      }, { status: 409 });
    }
    throw error;
  }

  let automationGate: unknown = null;
  try {
    if (chain.isChain && !chain.final && chain.nextTaskId) {
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
    workforcePlanDecision,
  });
}
