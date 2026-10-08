import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRunSupportsTimesheetExpectationAutomation } from "@/lib/workforce-timesheet-expectations";
import {
  attendanceExceptionEvents,
  auditEvents,
  automationExecutions,
  automationOperationalCases,
  complianceActionTasks,
  openShifts,
  payrollRuns,
  workforceTimesheetExpectations,
  workforceTimesheets,
} from "@/db/schema";

export const OPERATIONAL_REVIEW_CASE_TYPES = [
  "coverage_recovery",
  "timesheet_escalation",
  "missing_timesheet_escalation",
  "attendance_resolution",
  "payroll_readiness",
  "statutory_followup",
] as const;

export type OperationalReviewCaseType = (typeof OPERATIONAL_REVIEW_CASE_TYPES)[number];
export type AutomationOperationalCaseType = OperationalReviewCaseType | "execution_dead_letter";

type ReviewConfig = {
  trigger: string[];
  idField: string;
  sourceType: string;
  ownerTeam: string;
  title: string;
};

const REVIEW_CONFIG: Record<OperationalReviewCaseType, ReviewConfig> = {
  coverage_recovery: {
    trigger: ["coverage.gap_approaching"],
    idField: "openShiftId",
    sourceType: "open_shift",
    ownerTeam: "Workforce Operations",
    title: "Coverage recovery review",
  },
  timesheet_escalation: {
    trigger: ["timesheet.cutoff_approaching"],
    idField: "timesheetId",
    sourceType: "workforce_timesheet",
    ownerTeam: "Workforce / Payroll",
    title: "Timesheet cutoff escalation",
  },
  missing_timesheet_escalation: {
    trigger: ["timesheet.missing_approaching"],
    idField: "timesheetExpectationId",
    sourceType: "workforce_timesheet_expectation",
    ownerTeam: "Workforce / Payroll",
    title: "Missing timesheet escalation",
  },
  attendance_resolution: {
    trigger: ["attendance.exception_created", "attendance.exception_aging"],
    idField: "attendanceExceptionId",
    sourceType: "attendance_exception",
    ownerTeam: "People Operations",
    title: "Attendance exception resolution",
  },
  payroll_readiness: {
    trigger: ["payroll.pay_date_approaching"],
    idField: "payrollRunId",
    sourceType: "payroll_run",
    ownerTeam: "Payroll Operations",
    title: "Payroll readiness review",
  },
  statutory_followup: {
    trigger: ["government.remittance_due"],
    idField: "complianceActionTaskId",
    sourceType: "compliance_action_task",
    ownerTeam: "Compliance Operations",
    title: "Statutory remittance follow-up",
  },
};

export function validOperationalReviewType(value: unknown): value is OperationalReviewCaseType {
  return typeof value === "string"
    && (OPERATIONAL_REVIEW_CASE_TYPES as readonly string[]).includes(value);
}

export function operationalReviewTriggerAllowed(caseType: OperationalReviewCaseType, trigger: string) {
  return REVIEW_CONFIG[caseType].trigger.includes(trigger);
}

function positiveId(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** These are source identifiers, never values supplied by workflow authors. */
export function operationalReviewSourceId(caseType: OperationalReviewCaseType, context: Record<string, unknown>) {
  return positiveId(context[REVIEW_CONFIG[caseType].idField]);
}

export function operationalReviewPolicyBlocks(input: {
  caseType: OperationalReviewCaseType;
  trigger: string;
  context: Record<string, unknown>;
  employeeId?: number | null;
}): string[] {
  const config = REVIEW_CONFIG[input.caseType];
  const blocks: string[] = [];
  if (!config.trigger.includes(input.trigger)) {
    blocks.push(`${input.caseType} cannot run on ${input.trigger}.`);
  }
  if (operationalReviewSourceId(input.caseType, input.context) == null) {
    blocks.push(`${input.caseType} requires an authoritative ${config.idField}.`);
  }
  if (input.caseType === "timesheet_escalation" && positiveId(input.context.timesheetVersion) == null) {
    blocks.push("Timesheet escalation requires the exact source version.");
  }
  if (input.caseType === "missing_timesheet_escalation" && positiveId(input.context.timesheetExpectationVersion) == null) {
    blocks.push("Missing-timesheet escalation requires the exact expectation version.");
  }
  if (input.caseType === "attendance_resolution" && positiveId(input.employeeId) == null) {
    blocks.push("Attendance resolution requires an employee-scoped authoritative exception.");
  }
  if (input.caseType === "timesheet_escalation" && positiveId(input.employeeId) == null) {
    blocks.push("Timesheet escalation requires an employee-scoped authoritative timesheet.");
  }
  if (input.caseType === "missing_timesheet_escalation" && positiveId(input.employeeId) == null) {
    blocks.push("Missing-timesheet escalation requires an employee-scoped authoritative expectation.");
  }
  return blocks;
}

type SourceEvidence = {
  sourceVersion: number | null;
  employeeId: number | null;
  active: boolean;
  evidence: Record<string, string | number | boolean | null>;
};

/** Re-fetch the authoritative row at execution/close time; never trust an
 * event context for current status, tenant, employee ownership or approval.
 */
export async function loadOperationalReviewSource(input: {
  organizationId: number;
  caseType: OperationalReviewCaseType;
  sourceId: number;
}): Promise<SourceEvidence | null> {
  const { organizationId, caseType, sourceId } = input;
  if (caseType === "coverage_recovery") {
    const [row] = await db.select().from(openShifts).where(and(
      eq(openShifts.organizationId, organizationId),
      eq(openShifts.id, sourceId),
    )).limit(1);
    if (!row) return null;
    return {
      sourceVersion: null,
      employeeId: null,
      active: row.status === "open",
      evidence: {
        openShiftId: row.id, status: row.status,
        workDate: String(row.workDate), worksiteId: row.worksiteId,
        shiftDefinitionId: row.shiftDefinitionId,
        sourceRequirementId: row.sourceRequirementId,
        coverageSlots: row.slots,
      },
    };
  }
  if (caseType === "timesheet_escalation") {
    const [row] = await db.select().from(workforceTimesheets).where(and(
      eq(workforceTimesheets.organizationId, organizationId),
      eq(workforceTimesheets.id, sourceId),
    )).limit(1);
    if (!row) return null;
    return {
      sourceVersion: row.version,
      employeeId: row.employeeId,
      active: ["submitted", "rejected", "stale"].includes(row.status),
      evidence: {
        timesheetId: row.id, version: row.version, status: row.status,
        employeeId: row.employeeId, periodStart: String(row.periodStart),
        periodEnd: String(row.periodEnd),
        blockerCount: row.blockerCount, exceptionCount: row.exceptionCount,
        snapshotHash: row.snapshotHash,
      },
    };
  }
  if (caseType === "missing_timesheet_escalation") {
    const [row] = await db.select().from(workforceTimesheetExpectations).where(and(
      eq(workforceTimesheetExpectations.organizationId, organizationId),
      eq(workforceTimesheetExpectations.id, sourceId),
    )).limit(1);
    if (!row) return null;
    const [run] = await db.select({
      id: payrollRuns.id,
      status: payrollRuns.status,
      periodLabel: payrollRuns.periodLabel,
      payDate: payrollRuns.payDate,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.id, row.payrollRunId),
    )).limit(1);
    const inactiveRun = !run || !payrollRunSupportsTimesheetExpectationAutomation(run.status);
    return {
      sourceVersion: row.version,
      employeeId: row.employeeId,
      active: row.status === "expected" && !inactiveRun,
      evidence: {
        timesheetExpectationId: row.id,
        timesheetExpectationVersion: row.version,
        expectationStatus: row.status,
        employeeId: row.employeeId,
        payrollRunId: row.payrollRunId,
        payrollRunStatus: run?.status ?? null,
        payrollPeriodLabel: run?.periodLabel ?? null,
        payDate: run?.payDate ? String(run.payDate) : null,
        periodStart: String(row.periodStart),
        periodEnd: String(row.periodEnd),
        expectedBy: String(row.expectedBy),
        enforcementMode: row.enforcementMode,
        latestTimesheetId: row.latestTimesheetId,
        latestTimesheetVersion: row.latestTimesheetVersion,
      },
    };
  }
  if (caseType === "attendance_resolution") {
    const [row] = await db.select().from(attendanceExceptionEvents).where(and(
      eq(attendanceExceptionEvents.organizationId, organizationId),
      eq(attendanceExceptionEvents.id, sourceId),
    )).limit(1);
    if (!row) return null;
    return {
      sourceVersion: null,
      employeeId: row.employeeId,
      active: row.status === "open",
      evidence: {
        attendanceExceptionId: row.id, employeeId: row.employeeId,
        workDate: String(row.workDate), exceptionKind: row.exceptionKind,
        severity: row.severity, status: row.status,
        ownerUserId: row.ownerUserId,
        slaDueAt: row.slaDueAt?.toISOString() ?? null,
        fingerprintSha256: row.fingerprintSha256,
      },
    };
  }
  if (caseType === "payroll_readiness") {
    const [row] = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.id, sourceId),
    )).limit(1);
    if (!row) return null;
    return {
      sourceVersion: null,
      employeeId: null,
      active: row.status !== "Released",
      evidence: {
        payrollRunId: row.id, status: row.status,
        periodLabel: row.periodLabel, payDate: String(row.payDate),
        periodStart: String(row.periodStart), periodEnd: String(row.periodEnd),
        exceptionCount: row.exceptions,
        legalEntityId: row.legalEntityId,
      },
    };
  }
  const [row] = await db.select().from(complianceActionTasks).where(and(
    eq(complianceActionTasks.organizationId, organizationId),
    eq(complianceActionTasks.id, sourceId),
    eq(complianceActionTasks.sourceType, "statutory_remittance"),
  )).limit(1);
  if (!row) return null;
  return {
    sourceVersion: row.escalationEpisode,
    employeeId: null,
    active: row.status !== "resolved" && row.severity !== "info",
    evidence: {
      complianceActionTaskId: row.id, agency: row.agency,
      applicableMonth: row.applicableMonth, dueDate: row.dueDate ? String(row.dueDate) : null,
      status: row.status, severity: row.severity, escalationEpisode: row.escalationEpisode,
    },
  };
}

export async function prepareOperationalReviewCase(input: {
  organizationId: number;
  executionId: number;
  actionIndex: number;
  trigger: string;
  eventKey: string;
  caseType: OperationalReviewCaseType;
  reason: string;
  employeeId?: number | null;
  context: Record<string, unknown>;
}) {
  const blocks = operationalReviewPolicyBlocks(input);
  if (blocks.length) throw new Error(blocks.join(" "));
  const sourceId = operationalReviewSourceId(input.caseType, input.context);
  if (!sourceId) throw new Error("The operational review source is missing.");

  const source = await loadOperationalReviewSource({
    organizationId: input.organizationId,
    caseType: input.caseType,
    sourceId,
  });
  if (!source || !source.active) {
    throw new Error("The authoritative review source is missing or no longer needs action.");
  }
  if (source.employeeId != null && source.employeeId !== input.employeeId) {
    throw new Error("The triggering employee does not match the authoritative review source.");
  }
  if (input.caseType === "timesheet_escalation" && source.sourceVersion !== input.context.timesheetVersion) {
    throw new Error("Timesheet revision changed since the original cutoff event.");
  }
  if (input.caseType === "missing_timesheet_escalation"
      && source.sourceVersion !== input.context.timesheetExpectationVersion) {
    throw new Error("Timesheet expectation changed since the missing-timesheet event.");
  }
  if (input.caseType === "statutory_followup" &&
      input.context.complianceActionTaskId !== sourceId) {
    throw new Error("Statutory action source does not match the authoritative compliance task.");
  }
  const config = REVIEW_CONFIG[input.caseType];
  const title = `${config.title} #${sourceId}`;
  const detail = input.reason.slice(0, 240);
  const evidence = {
    ...source.evidence,
    trigger: input.trigger,
    eventKey: input.eventKey,
    observedSourceVersion: source.sourceVersion,
    manualDecisionRequired: true,
    changesAppliedAutomatically: false,
  };

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(automationOperationalCases).values({
      organizationId: input.organizationId,
      caseType: input.caseType,
      sourceType: config.sourceType,
      sourceId,
      sourceVersion: source.sourceVersion,
      executionId: input.executionId,
      stepIndex: input.actionIndex,
      employeeId: source.employeeId,
      ownerTeam: config.ownerTeam,
      title,
      detail,
      evidence,
      status: "open",
    }).onConflictDoNothing().returning();
    if (created) {
      await tx.insert(auditEvents).values({
        organizationId: input.organizationId,
        actor: "Automation Studio",
        action: "Governed WFM/payroll review prepared",
        resource: title,
        metadata: {
          reviewCaseId: created.id, caseType: input.caseType,
          sourceType: config.sourceType, sourceId,
          sourceVersion: source.sourceVersion,
          executionId: input.executionId, actionIndex: input.actionIndex,
          changesAppliedAutomatically: false,
        },
      });
      return { case: created, created: true };
    }
    const [existing] = await tx.select().from(automationOperationalCases).where(and(
      eq(automationOperationalCases.organizationId, input.organizationId),
      eq(automationOperationalCases.caseType, input.caseType),
      eq(automationOperationalCases.sourceId, sourceId),
    )).limit(1);
    if (!existing) throw new Error("Operational review idempotency lookup failed.");
    if (existing.status === "resolved") {
      throw new Error("The source reopened after its review case was resolved. Reopen the case through Execution Center before a new automation can complete.");
    }
    return { case: existing, created: false };
  });
}

/** Underlying source must be resolved through its normal governed workflow.
 * Resolving an automation review case is never a shortcut to payroll release.
 */
export async function operationalReviewSourceResolved(input: {
  organizationId: number;
  caseType: AutomationOperationalCaseType;
  sourceId: number;
}) {
  if (input.caseType === "execution_dead_letter") return true;
  const source = await loadOperationalReviewSource({
    organizationId: input.organizationId,
    caseType: input.caseType,
    sourceId: input.sourceId,
  });
  return Boolean(source && !source.active);
}

export async function createExecutionDeadLetter(input: {
  organizationId: number;
  executionId: number;
  stepIndex: number;
  actor: string;
  actorUserId: number;
  note: string;
  latestFailure: { type: string; error: string };
}) {
  const [execution] = await db.select().from(automationExecutions).where(and(
    eq(automationExecutions.organizationId, input.organizationId),
    eq(automationExecutions.id, input.executionId),
  )).limit(1);
  if (!execution || !["failed", "partial"].includes(execution.status)) {
    throw new Error("Only an existing failed/partial execution can be quarantined.");
  }
  const results = Array.isArray(execution.result) ? execution.result : [];
  const latestStep = results.filter((value): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value)
      && Number((value as Record<string, unknown>).stepIndex) === input.stepIndex
  ).at(-1);
  if (!latestStep || latestStep.status !== "failed" || latestStep.type !== input.latestFailure.type) {
    throw new Error("The failed step changed before quarantine; refresh the execution evidence.");
  }
  return db.transaction(async (tx) => {
    const title = `Automation dead letter #${input.executionId} · step ${input.stepIndex + 1}`;
    const [created] = await tx.insert(automationOperationalCases).values({
      organizationId: input.organizationId,
      caseType: "execution_dead_letter",
      sourceType: "automation_execution",
      sourceId: input.executionId,
      executionId: input.executionId,
      stepIndex: input.stepIndex,
      employeeId: execution.employeeId,
      ownerTeam: "Automation Operations",
      title,
      detail: input.note.slice(0, 480),
      evidence: {
        stepType: input.latestFailure.type,
        lastError: input.latestFailure.error.slice(0, 1600),
        trigger: execution.trigger,
        eventKey: execution.eventKey,
        ruleId: execution.ruleId,
        quarantinedByUserId: input.actorUserId,
        manualReviewRequired: true,
        actionsReplayed: false,
      },
      status: "open",
    }).onConflictDoNothing().returning();
    if (created) {
      await tx.insert(auditEvents).values({
        organizationId: input.organizationId,
        actor: input.actor,
        action: "Automation execution dead letter opened",
        resource: title,
        metadata: {
          caseId: created.id, executionId: input.executionId,
          stepIndex: input.stepIndex, stepType: input.latestFailure.type,
          reason: input.note, actionsReplayed: false,
        },
      });
      return { case: created, created: true };
    }
    const [existing] = await tx.select().from(automationOperationalCases).where(and(
      eq(automationOperationalCases.organizationId, input.organizationId),
      eq(automationOperationalCases.caseType, "execution_dead_letter"),
      eq(automationOperationalCases.sourceId, input.executionId),
      eq(automationOperationalCases.stepIndex, input.stepIndex),
    )).limit(1);
    if (!existing) throw new Error("Dead-letter idempotency lookup failed.");
    return { case: existing, created: false };
  });
}
