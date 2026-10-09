import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { approvalChainInstances, approvalTasks, auditEvents, automationExecutions, employees, hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps, leaveRequestIntervalSets, leaveRequests, payrollRuns, separationRecords, workforceTimesheets, workforcePlanningScenarios, workforcePlans } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { canDecide } from "@/lib/delegation";
import { authorizedDynamicGroupMember } from "@/lib/dynamic-group-authorization";
import {
  frozenGovernedHandoffEvidence,
  governedHandoffSourceKey,
  isGovernedHandoffType,
  loadGovernedHandoffSource,
} from "@/lib/governed-approval-handoffs";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertMembership, assertOrganizationUnitAccess } from "@/lib/access";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { isPublicDemoIdentity } from "@/lib/demo-security";
import { resumeAutomationExecutionFromApproval, runAutomationEventSafely } from "@/lib/automation";
import { checkEmployeeLeaveEligibility } from "@/lib/hcm-leave-employment";
import { advanceApprovalChainAfterDecisionTx } from "@/lib/approval-chains";
import { verifyPayrollApprovalSnapshot } from "@/lib/payroll-approval-integrity";
import {
  advanceHcmBusinessProcessAfterApprovalTx,
  finalizeHcmBusinessProcessSource,
} from "@/lib/hcm-business-process";

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

  const [hcmBusinessProcessApproval] = await db.select({
    stepId: hcmBusinessProcessInstanceSteps.id,
    stepStatus: hcmBusinessProcessInstanceSteps.status,
    instanceId: hcmBusinessProcessInstances.id,
    employeeId: hcmBusinessProcessInstances.employeeId,
    initiatedByUserId: hcmBusinessProcessInstances.initiatedByUserId,
    processStatus: hcmBusinessProcessInstances.status,
  }).from(hcmBusinessProcessInstanceSteps)
    .innerJoin(hcmBusinessProcessInstances, eq(
      hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id,
    ))
    .where(and(
      eq(hcmBusinessProcessInstanceSteps.approvalTaskId, taskId),
      eq(hcmBusinessProcessInstanceSteps.organizationId, task.organizationId),
      eq(hcmBusinessProcessInstances.organizationId, task.organizationId),
    )).limit(1);
  if (hcmBusinessProcessApproval) {
    if (hcmBusinessProcessApproval.processStatus !== "in_progress"
      || hcmBusinessProcessApproval.stepStatus !== "pending") {
      return Response.json({
        error: "This HCM business-process approval is no longer pending.",
      }, { status: 409 });
    }
    if (hcmBusinessProcessApproval.employeeId != null) {
      const [worker] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees).where(and(
        eq(employees.id, hcmBusinessProcessApproval.employeeId),
        eq(employees.organizationId, task.organizationId),
      )).limit(1);
      if (!worker) {
        return Response.json({ error: "The HCM business process no longer has a valid employee." }, { status: 409 });
      }
      const scopeDenied = await assertOrganizationUnitAccess(
        sessionUser.id, task.organizationId, worker.orgUnitId,
        "This HCM business-process approval concerns an employee outside your assigned unit.",
      );
      if (scopeDenied) return scopeDenied;
    } else {
      const scopeDenied = await assertOrganizationUnitAccess(
        sessionUser.id, task.organizationId, null,
        "Company-wide HCM business-process approvals require company-wide access.",
      );
      if (scopeDenied) return scopeDenied;
    }
    if (hcmBusinessProcessApproval.initiatedByUserId === sessionUser.id) {
      return Response.json({
        error: "Maker-checker control: the HCM change requester cannot decide their own approval.",
        businessProcessInstanceId: hcmBusinessProcessApproval.instanceId,
      }, { status: 403 });
    }
  }


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

  if (task.approvalChainInstanceId) {
    const [handoff] = await db.select().from(approvalChainInstances).where(and(
      eq(approvalChainInstances.id, task.approvalChainInstanceId),
      eq(approvalChainInstances.organizationId, task.organizationId),
    )).limit(1);
    if (handoff && isGovernedHandoffType(handoff.sourceType)) {
      const evidence = frozenGovernedHandoffEvidence(handoff.routingSnapshot);
      if (!evidence
          || evidence.sourceType !== handoff.sourceType
          || handoff.sourceKey !== governedHandoffSourceKey(evidence.sourceId, evidence.sourceHash)) {
        return Response.json({ error: "Human handoff is missing valid frozen source evidence." }, { status: 409 });
      }
      if (evidence.initiatedByUserId === sessionUser.id) {
        return Response.json({
          error: "Maker-checker: the person requesting roster/separation review cannot approve their own handoff.",
        }, { status: 403 });
      }
      const liveSource = await loadGovernedHandoffSource({
        organizationId: task.organizationId,
        sourceType: evidence.sourceType,
        sourceId: evidence.sourceId,
      });
      if (!liveSource?.eligible
          || liveSource.employeeId !== evidence.employeeId
          || liveSource.orgUnitId !== evidence.orgUnitId
          || liveSource.sourceHash !== evidence.sourceHash) {
        return Response.json({
          error: "Roster or separation source changed after submission. Request fresh human review of the current source.",
        }, { status: 409 });
      }
      const scopeDenied = await assertOrganizationUnitAccess(
        sessionUser.id,
        task.organizationId,
        liveSource.orgUnitId,
        "This governed handoff concerns a worker outside your assigned organization unit.",
      );
      if (scopeDenied) return scopeDenied;
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

  // The base named/role approver must still match. Dynamic Groups can only
  // narrow that authority, never turn an unrelated worker into an approver.
  let dynamicGroupScope: {
    code: string;
    id: number;
    version: number;
  } | null = null;
  if (task.approvalChainInstanceId != null && task.approvalChainStepIndex != null) {
    const [chainInstance] = await db.select().from(approvalChainInstances).where(and(
      eq(approvalChainInstances.id, task.approvalChainInstanceId),
      eq(approvalChainInstances.organizationId, task.organizationId),
    )).limit(1);
    if (!chainInstance || !Array.isArray(chainInstance.stepsSnapshot)) {
      return Response.json({ error: "Approval routing evidence is missing." }, { status: 409 });
    }
    const frozen = chainInstance.stepsSnapshot[task.approvalChainStepIndex] as Record<string, unknown> | undefined;
    if (!frozen || String(frozen.approver ?? "") !== task.approver) {
      return Response.json({ error: "Approval step evidence no longer matches the assigned task." }, { status: 409 });
    }
    if (typeof frozen.dynamicGroupCode === "string" && frozen.dynamicGroupCode) {
      if (!Number.isInteger(frozen.dynamicGroupId) || !Number.isInteger(frozen.dynamicGroupVersion)) {
        return Response.json({ error: "This approval's Dynamic Group routing snapshot is incomplete." }, { status: 409 });
      }
      if (payrollRunId) {
        return Response.json({ error: "Payroll checker approvals cannot be reassigned by Dynamic Group routing." }, { status: 409 });
      }
      dynamicGroupScope = {
        code: frozen.dynamicGroupCode,
        id: Number(frozen.dynamicGroupId),
        version: Number(frozen.dynamicGroupVersion),
      };
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
  let groupEligibility = null;
  if (dynamicGroupScope) {
    groupEligibility = await authorizedDynamicGroupMember({
      organizationId: task.organizationId,
      userId: sessionUser.id,
      groupId: dynamicGroupScope.id,
      expectedCode: dynamicGroupScope.code,
      expectedVersion: dynamicGroupScope.version,
    });
    if (!groupEligibility.eligible) {
      return Response.json({
        error: groupEligibility.reason === "group_version_changed"
          ? "The approval Dynamic Group definition changed. Resubmit through the current policy."
          : "The assigned approver is not an eligible live member of this approval's Dynamic Group.",
        code: "APPROVAL_DYNAMIC_GROUP_NOT_ELIGIBLE",
        reason: groupEligibility.reason,
      }, { status: groupEligibility.reason === "group_version_changed" ? 409 : 403 });
    }
  }

  const onBehalf = decision.roleMatched ? null : actor.toLowerCase() !== task.approver.toLowerCase() ? task.approver : null;

  let updated;
  let leaveStaleTimesheetIds: number[] = [];
  let workforcePlanDecision: { scenarioId: number; status: "approved" | "rejected" } | null = null;
  let chain: Awaited<ReturnType<typeof advanceApprovalChainAfterDecisionTx>> = {
    isChain: false,
    final: true,
    nextTaskId: null,
    instanceId: null,
  };
  let hcmBusinessProcess: Awaited<ReturnType<typeof advanceHcmBusinessProcessAfterApprovalTx>> = {
    isHcmProcess: false,
    final: false,
    status: null,
    instanceId: null,
    nextTaskId: null,
    sourceType: null,
    sourceKey: null,
  };
  try {
    const decisionResult = await db.transaction(async (tx) => {
      if (dynamicGroupScope) {
        // Prevent concurrent group-definition or membership-link updates during
        // this decision, then re-evaluate live membership before the task write.
        await tx.execute(sql`select id from dynamic_worker_groups
          where id = ${dynamicGroupScope.id} and organization_id = ${task.organizationId}
          for share`);
        await tx.execute(sql`select id from user_organizations
          where user_id = ${sessionUser.id} and organization_id = ${task.organizationId}
          for share`);
        const currentEligibility = await authorizedDynamicGroupMember({
          organizationId: task.organizationId,
          userId: sessionUser.id,
          groupId: dynamicGroupScope.id,
          expectedCode: dynamicGroupScope.code,
          expectedVersion: dynamicGroupScope.version,
        });
        if (!currentEligibility.eligible) throw new Error("APPROVAL_DYNAMIC_GROUP_NOT_ELIGIBLE");
      }
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

      // The linked leave decision is an authoritative payroll and WFM source.
      // Commit leave status, stale overlapping timesheets and approval audit
      // inside the SAME transaction as the approval task. Revisions use the
      // leave row lock too, so no reviewed interval revision can race approval.
      await tx.execute(sql`select id from leave_requests
        where organization_id = ${task.organizationId} and approval_task_id = ${taskId}
        for update`);
      const linkedLeaves = await tx.select().from(leaveRequests).where(and(
        eq(leaveRequests.organizationId, task.organizationId),
        eq(leaveRequests.approvalTaskId, taskId),
      )).limit(2);
      if (linkedLeaves.length > 1) throw new Error("LEAVE_APPROVAL_SOURCE_AMBIGUOUS");
      const leaveForDecision = linkedLeaves[0] ?? null;
      let staleLeaveTimesheetIds: number[] = [];
      if (leaveForDecision) {
        if (leaveForDecision.status !== "Pending") throw new Error("LEAVE_APPROVAL_STALE");
        if (status === "Approved") {
          await tx.execute(sql`select id from employees where id = ${leaveForDecision.employeeId}
            and organization_id = ${task.organizationId} for share`);
          const [worker] = await tx.select().from(employees).where(and(
            eq(employees.id, leaveForDecision.employeeId),
            eq(employees.organizationId, task.organizationId),
          )).limit(1);
          if (!worker) throw new Error("LEAVE_EMPLOYMENT_NOT_ELIGIBLE");
          const [currentSeparation] = worker.status === "Separating"
            ? await tx.select({ lastDay: separationRecords.lastDay }).from(separationRecords)
              .where(and(
                eq(separationRecords.organizationId, task.organizationId),
                eq(separationRecords.employeeId, worker.id),
                inArray(separationRecords.status, ["draft", "approved"]),
              )).orderBy(desc(separationRecords.id)).limit(1)
            : [];
          const eligible = checkEmployeeLeaveEligibility({
            employeeStatus: worker.status,
            employmentStartDate: String(worker.startDate),
            leaveStartDate: String(leaveForDecision.startDate),
            leaveEndDate: String(leaveForDecision.endDate),
            separationLastDay: currentSeparation?.lastDay ?? null,
          });
          if (eligible) throw new Error("LEAVE_EMPLOYMENT_NOT_ELIGIBLE");
        }
        const [decidedLeave] = await tx.update(leaveRequests).set({
          status, decidedBy: actor,
        }).where(and(
          eq(leaveRequests.id, leaveForDecision.id),
          eq(leaveRequests.organizationId, task.organizationId),
          eq(leaveRequests.status, "Pending"),
        )).returning();
        if (!decidedLeave) throw new Error("LEAVE_APPROVAL_STALE");
        if (status === "Approved") {
          const stale = await tx.update(workforceTimesheets).set({
            status: "stale", updatedAt: new Date(),
          }).where(and(
            eq(workforceTimesheets.organizationId, task.organizationId),
            eq(workforceTimesheets.employeeId, decidedLeave.employeeId),
            lte(workforceTimesheets.periodStart, String(decidedLeave.endDate)),
            gte(workforceTimesheets.periodEnd, String(decidedLeave.startDate)),
            inArray(workforceTimesheets.status, ["submitted", "approved"]),
          )).returning({ id: workforceTimesheets.id });
          staleLeaveTimesheetIds = stale.map(row => row.id);
        }
        const [currentSet] = await tx.select().from(leaveRequestIntervalSets).where(and(
          eq(leaveRequestIntervalSets.organizationId, task.organizationId),
          eq(leaveRequestIntervalSets.leaveRequestId, decidedLeave.id),
          eq(leaveRequestIntervalSets.status, "current"),
        )).limit(1);
        await tx.insert(auditEvents).values({
          organizationId: task.organizationId,
          actor,
          action: status === "Approved" ? "Leave independently approved" : "Leave declined",
          resource: `leave #${decidedLeave.id}`,
          metadata: {
            leaveId: decidedLeave.id,
            approvalTaskId: taskId,
            deciderUserId: sessionUser.id,
            intervalSetId: currentSet?.id ?? null,
            intervalRevision: currentSet?.revision ?? null,
            staleTimesheetIds: staleLeaveTimesheetIds,
          },
        });
      }

      const chainResult = await advanceApprovalChainAfterDecisionTx(tx, {
        taskId,
        decision: status,
        decidedBy: actor,
      });

      const hcmResult = await advanceHcmBusinessProcessAfterApprovalTx(tx, {
        taskId,
        decision: status,
        actorUserId: sessionUser.id,
        actorName: actor,
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
          dynamicGroupRestriction: dynamicGroupScope
            ? { ...dynamicGroupScope, employeeId: groupEligibility?.employeeId, membershipCheckedLive: true }
            : null,
          approvalChainFinal: chainResult.final,
          nextApprovalTaskId: chainResult.nextTaskId,
          hcmBusinessProcessInstanceId: hcmResult.instanceId,
          hcmBusinessProcessFinal: hcmResult.final,
          hcmBusinessProcessStatus: hcmResult.status,
        },
      });

      return { updatedTask, chainResult, hcmResult, sourceDecision, staleLeaveTimesheetIds };
    });
    updated = decisionResult.updatedTask;
    leaveStaleTimesheetIds = decisionResult.staleLeaveTimesheetIds;
    chain = decisionResult.chainResult;
    hcmBusinessProcess = decisionResult.hcmResult;
    workforcePlanDecision = decisionResult.sourceDecision;
  } catch (error) {
    if (error instanceof Error && (
      error.message === "PAYROLL_APPROVAL_CONFLICT" ||
      error.message === "APPROVAL_TASK_CONFLICT" ||
      error.message === "LEAVE_APPROVAL_STALE" ||
      error.message === "LEAVE_APPROVAL_SOURCE_AMBIGUOUS" ||
      error.message === "LEAVE_EMPLOYMENT_NOT_ELIGIBLE" ||
      error.message === "WORKFORCE_PLAN_APPROVAL_CONFLICT" ||
      error.message === "APPROVAL_DYNAMIC_GROUP_NOT_ELIGIBLE" ||
      error.message.startsWith("Business process ") ||
      error.message.startsWith("Business-process ")
    )) {
      return Response.json({
        error: "This approval changed while your decision was being saved. Refresh to see the current state.",
      }, { status: 409 });
    }
    throw error;
  }

  let hcmBusinessProcessSource: unknown = null;
  if (hcmBusinessProcess.isHcmProcess && hcmBusinessProcess.final && hcmBusinessProcess.instanceId) {
    try {
      hcmBusinessProcessSource = await finalizeHcmBusinessProcessSource({
        instanceId: hcmBusinessProcess.instanceId,
        actorUserId: sessionUser.id,
        actorName: actor,
      });
    } catch (error) {
      hcmBusinessProcessSource = {
        status: "finalization_error",
        error: error instanceof Error ? error.message : "The HCM source transaction could not be finalized.",
      };
      try {
        await db.insert(auditEvents).values({
          organizationId: task.organizationId,
          actor,
          action: "HCM business-process source finalization failed",
          resource: task.title,
          metadata: {
            businessProcessInstanceId: hcmBusinessProcess.instanceId,
            error: error instanceof Error ? error.message.slice(0, 2000) : "Unknown finalization error",
          },
        });
      } catch {
        // The checker decision is durable; audit fallback must not rewrite it.
      }
    }
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
  if (linkedLeave && status === "Approved") {
      // Source status, timesheet invalidation and audit already committed in
      // the approval-task transaction. Remaining operations only dispatch
      // post-commit notifications and cannot rewrite the decision.
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
    hcmBusinessProcess,
    hcmBusinessProcessSource,
    workforcePlanDecision,
  });
}
