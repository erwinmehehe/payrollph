import { and, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests,
  attendanceExceptionEvents,
  compensationCycles,
  compensationProposals,
  employeePayRevisions,
  employeePayoutChangeRequests,
  employeeRestDayRevisions,
  employees,
  payrollEntries,
  payrollJobs,
  payrollRuns,
  workforceTimesheets,
  workerEffectiveChanges,
} from "@/db/schema";
import {
  evaluatePayrollConnectedRelease,
  type ConnectedReleaseResult,
} from "@/lib/payroll-connected-release-gate";

const MAX_SOURCE_ROWS = 500;

/**
 * Opt-in must be BOTH explicit and tenant-scoped. No wildcard/all-tenants
 * switch: enabling a feature flag must not suddenly stop every employer's pay.
 */
export function connectedPayrollReleaseGateEnabled(organizationId: number) {
  if (process.env.PAYROLL_CONNECTED_RELEASE_GATE_ENABLED !== "true"
    || !Number.isSafeInteger(organizationId) || organizationId <= 0) return false;
  const ids = (process.env.PAYROLL_CONNECTED_RELEASE_GATE_ORGANIZATION_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return ids.includes(String(organizationId));
}

function blocked(code: string, detail: string): ConnectedReleaseResult {
  return {
    version: "connected-payroll-release-v1",
    ready: false,
    incomplete: true,
    blockingCount: 1,
    reviewCount: 0,
    findings: [{ area: "integrity", severity: "blocker", code, detail }],
  };
}

/**
 * Read-only. Invoked ONLY by already authorized payroll workflows.
 * Block scoped payroll rather than build evidence using today's org-unit /
 * legal-entity assignments instead of effective-dated historical membership.
 *
 * NOT a transactional source snapshot. Final money-bearing gates need an
 * independently approved immutable source manifest and writer coordination.
 */
export async function buildPayrollConnectedReleaseReadiness(runId: number): Promise<ConnectedReleaseResult> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return blocked("PAYROLL_RUN_NOT_FOUND", "The payroll run does not exist.");
  if (!connectedPayrollReleaseGateEnabled(run.organizationId)) {
    return blocked("CONNECTED_RELEASE_GATE_DISABLED",
      "Connected release enforcement is not enabled for this employer.");
  }
  if (process.env.PAYROLL_CONNECTED_IMPACT_ENABLED !== "true") {
    return blocked("CONNECTED_IMPACT_CONFIG_REQUIRED",
      "Connected impact source inspection must be enabled and reviewed before release enforcement.");
  }
  if (run.scopeOrgUnitId != null || run.legalEntityId != null) {
    return blocked("PAYROLL_RELEASE_HISTORICAL_SCOPE_UNVERIFIED",
      "Scoped payroll requires independently tested historical employee/position assignment reconstruction.");
  }

  const [entries, latestJobs, eligibleEmployees] = await Promise.all([
    db.select({ employeeId: payrollEntries.employeeId })
      .from(payrollEntries)
      .where(eq(payrollEntries.payrollRunId, run.id)),
    db.select({
      status: payrollJobs.status,
      completedAt: payrollJobs.completedAt,
      createdAt: payrollJobs.createdAt,
      organizationId: payrollJobs.organizationId,
      payrollRunId: payrollJobs.payrollRunId,
    }).from(payrollJobs).where(eq(payrollJobs.payrollRunId, run.id)),
    db.select({ id: employees.id }).from(employees).where(and(
      eq(employees.organizationId, run.organizationId),
      eq(employees.status, "Active"),
      lte(employees.startDate, run.periodEnd),
    )),
  ]);

  const completedJob = latestJobs.length === 1 && latestJobs[0].status === "completed"
    && latestJobs[0].organizationId === run.organizationId
    && latestJobs[0].payrollRunId === run.id
    && latestJobs[0].completedAt != null
    && Number(run.totalChunks) > 0
    && Number(run.processedChunks) === Number(run.totalChunks)
    && entries.length > 0
    && entries.length === Number(run.employeeCount)
      ? latestJobs[0]
      : null;

  // The queued job's createdAt is a CONSERVATIVE start-of-calculation
  // baseline. Checking only completion time would miss HR/WFM/HCM writes
  // committed while early payroll chunks were already being calculated.
  // The completedAt proof is still required to validate the job finished.
  if (!completedJob || !completedJob.createdAt) {
    return blocked("PAYROLL_CALCULATION_NOT_VERIFIABLE",
      "Completed payroll job evidence, employee coverage, or chunk counts are invalid. Recalculate before release.");
  }

  const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
  if (employeeIds.length === 0) {
    return blocked("PAYROLL_REGISTER_EMPTY", "No calculated employees were found.");
  }
  // These conditions are repeated for each query. Never load unrelated
  // employee histories and then filter them in memory.
  const companyId = run.organizationId;
  const earliest = run.periodStart;
  const end = run.periodEnd;
  const since = completedJob.createdAt;

  const [
    workerChanges,
    payoutChanges,
    correctionRows,
    exceptionRows,
    timesheetRows,
    proposalRows,
    payRevisions,
    restRevisions,
  ] = await Promise.all([
    db.select({
      id: workerEffectiveChanges.id, employeeId: workerEffectiveChanges.employeeId,
      status: workerEffectiveChanges.status, effectiveDate: workerEffectiveChanges.effectiveDate,
      appliedAt: workerEffectiveChanges.appliedAt,
    }).from(workerEffectiveChanges).where(and(
      eq(workerEffectiveChanges.organizationId, companyId),
      inArray(workerEffectiveChanges.employeeId, employeeIds),
      lte(workerEffectiveChanges.effectiveDate, end),
      or(
        inArray(workerEffectiveChanges.status, ["pending", "pending_approval", "scheduled", "failed"]),
        and(eq(workerEffectiveChanges.status, "applied"),
          or(gt(workerEffectiveChanges.appliedAt, since), isNull(workerEffectiveChanges.appliedAt))),
      ),
    )).limit(MAX_SOURCE_ROWS + 1),
    db.select({
      id: employeePayoutChangeRequests.id, employeeId: employeePayoutChangeRequests.employeeId,
      status: employeePayoutChangeRequests.status, appliedAt: employeePayoutChangeRequests.appliedAt,
    }).from(employeePayoutChangeRequests).where(and(
      eq(employeePayoutChangeRequests.organizationId, companyId),
      inArray(employeePayoutChangeRequests.employeeId, employeeIds),
      or(
        inArray(employeePayoutChangeRequests.status, ["pending", "pending_approval", "scheduled", "failed"]),
        and(eq(employeePayoutChangeRequests.status, "approved"),
          or(gt(employeePayoutChangeRequests.appliedAt, since), isNull(employeePayoutChangeRequests.appliedAt))),
      ),
    )).limit(MAX_SOURCE_ROWS + 1),
    db.select({
      id: attendanceCorrectionRequests.id, employeeId: attendanceCorrectionRequests.employeeId,
      status: attendanceCorrectionRequests.status, workDate: attendanceCorrectionRequests.workDate,
      appliedAt: attendanceCorrectionRequests.appliedAt,
    }).from(attendanceCorrectionRequests).where(and(
      eq(attendanceCorrectionRequests.organizationId, companyId),
      inArray(attendanceCorrectionRequests.employeeId, employeeIds),
      gte(attendanceCorrectionRequests.workDate, earliest),
      lte(attendanceCorrectionRequests.workDate, end),
      or(
        eq(attendanceCorrectionRequests.status, "pending"),
        and(eq(attendanceCorrectionRequests.status, "approved"),
          or(gt(attendanceCorrectionRequests.appliedAt, since), isNull(attendanceCorrectionRequests.appliedAt))),
      ),
    )).limit(MAX_SOURCE_ROWS + 1),
    db.select({
      id: attendanceExceptionEvents.id, employeeId: attendanceExceptionEvents.employeeId,
      status: attendanceExceptionEvents.status, workDate: attendanceExceptionEvents.workDate,
      severity: attendanceExceptionEvents.severity,
    }).from(attendanceExceptionEvents).where(and(
      eq(attendanceExceptionEvents.organizationId, companyId),
      inArray(attendanceExceptionEvents.employeeId, employeeIds),
      eq(attendanceExceptionEvents.status, "open"),
      gte(attendanceExceptionEvents.workDate, earliest),
      lte(attendanceExceptionEvents.workDate, end),
    )).limit(MAX_SOURCE_ROWS + 1),
    db.select({
      id: workforceTimesheets.id, employeeId: workforceTimesheets.employeeId,
      periodStart: workforceTimesheets.periodStart, periodEnd: workforceTimesheets.periodEnd,
      version: workforceTimesheets.version, status: workforceTimesheets.status,
    }).from(workforceTimesheets).where(and(
      eq(workforceTimesheets.organizationId, companyId),
      inArray(workforceTimesheets.employeeId, employeeIds),
      eq(workforceTimesheets.periodStart, earliest),
      eq(workforceTimesheets.periodEnd, end),
    )).limit(MAX_SOURCE_ROWS + 1),
    db.select({
      id: compensationProposals.id, employeeId: compensationProposals.employeeId,
      status: compensationProposals.status, effectiveDate: compensationCycles.effectiveDate,
      appliedAt: compensationProposals.appliedAt,
    }).from(compensationProposals).innerJoin(
      compensationCycles, eq(compensationCycles.id, compensationProposals.cycleId),
    ).where(and(
      eq(compensationProposals.organizationId, companyId),
      eq(compensationCycles.organizationId, companyId),
      inArray(compensationProposals.employeeId, employeeIds),
      lte(compensationCycles.effectiveDate, end),
      or(
        inArray(compensationProposals.status, ["proposed", "pending_approval", "approved", "scheduled", "failed"]),
        and(eq(compensationProposals.status, "applied"),
          or(gt(compensationProposals.appliedAt, since), isNull(compensationProposals.appliedAt))),
      ),
    )).limit(MAX_SOURCE_ROWS + 1),
    db.select({
      id: employeePayRevisions.id, employeeId: employeePayRevisions.employeeId,
      effectiveDate: employeePayRevisions.effectiveDate, createdAt: employeePayRevisions.createdAt,
    }).from(employeePayRevisions).where(and(
      eq(employeePayRevisions.organizationId, companyId),
      inArray(employeePayRevisions.employeeId, employeeIds),
      lte(employeePayRevisions.effectiveDate, end),
      gt(employeePayRevisions.createdAt, since),
    )).limit(MAX_SOURCE_ROWS + 1),
    db.select({
      id: employeeRestDayRevisions.id, employeeId: employeeRestDayRevisions.employeeId,
      effectiveDate: employeeRestDayRevisions.effectiveDate, createdAt: employeeRestDayRevisions.createdAt,
    }).from(employeeRestDayRevisions).where(and(
      eq(employeeRestDayRevisions.organizationId, companyId),
      inArray(employeeRestDayRevisions.employeeId, employeeIds),
      lte(employeeRestDayRevisions.effectiveDate, end),
      gt(employeeRestDayRevisions.createdAt, since),
    )).limit(MAX_SOURCE_ROWS + 1),
  ]);

  const sourceSets = {
    workerChanges, payoutChanges, attendanceCorrections: correctionRows,
    attendanceExceptions: exceptionRows, timesheets: timesheetRows,
    compensationProposals: proposalRows, payRevisions, restDayRevisions: restRevisions,
  };
  const truncatedSources = Object.entries(sourceSets)
    .filter(([, rows]) => rows.length > MAX_SOURCE_ROWS)
    .map(([key]) => key);

  return evaluatePayrollConnectedRelease({
    periodStart: earliest,
    periodEnd: end,
    calculationStartedAt: since,
    calculatedEmployeeIds: entries.map((entry) => entry.employeeId),
    expectedEmployeeIds: eligibleEmployees.map((employee) => employee.id),
    workerChanges: workerChanges.slice(0, MAX_SOURCE_ROWS),
    payoutChanges: payoutChanges.slice(0, MAX_SOURCE_ROWS),
    attendanceCorrections: correctionRows.slice(0, MAX_SOURCE_ROWS),
    attendanceExceptions: exceptionRows.slice(0, MAX_SOURCE_ROWS),
    timesheets: timesheetRows.slice(0, MAX_SOURCE_ROWS),
    compensationProposals: proposalRows.slice(0, MAX_SOURCE_ROWS),
    payRevisions: payRevisions.slice(0, MAX_SOURCE_ROWS),
    restDayRevisions: restRevisions.slice(0, MAX_SOURCE_ROWS),
    truncatedSources,
  });
}

/** A DB/query error is a release BLOCK, never a silent green approval. */
export async function safePayrollConnectedReleaseReadiness(runId: number): Promise<ConnectedReleaseResult> {
  try {
    return await buildPayrollConnectedReleaseReadiness(runId);
  } catch {
    // Never place driver errors, query values, personal data, SQL or secrets in
    // a client-facing release readiness or audit payload.
    return blocked("CONNECTED_RELEASE_EVIDENCE_UNAVAILABLE",
      "HRIS/WFM/HCM evidence could not be verified. No release is permitted until the source review succeeds.");
  }
}
