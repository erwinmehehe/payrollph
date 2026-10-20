import { rememberWfmTimecardPeriod, type WorkforceTimecardPeriod } from "./workforce-manager-navigation";

/** Read-only bridge between two separately authorized dashboard/workforce reads.
 * Matching a payroll run is navigation evidence, NEVER payroll readiness.
 */
type Access = { role?: string; companyWide?: boolean } | null | undefined;
type RunLink = { id: number; periodLabel: string; scopeLabel: string; status: string };
export type WorkforceTimesheetCounts = {
  employees: number;
  approved: number;
  submitted: number;
  stale: number;
  expectedMissing: number;
  blockers: number;
};

export type WorkforcePayrollHandoff =
  | { kind: "restricted" }
  | { kind: "disabled" }
  | { kind: "unverified" }
  | { kind: "visible"; counts: WorkforceTimesheetCounts; runs: RunLink[] };

type Input = {
  organizationId: number;
  viewerId: number | null | undefined;
  access: Access;
  connectedNavigationEnabled: boolean;
  period: WorkforceTimecardPeriod;
  timesheetResponse: unknown;
  payrollRuns: unknown;
  /** The dashboard's selected legal-entity filter, if any. */
  selectedLegalEntityId?: number | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

const TIMESHEET_STATUSES = new Set(["submitted", "approved", "rejected", "stale"]);
const EXPECTATION_STATUSES = new Set(["expected", "submitted", "approved", "cancelled"]);

function readCounts(value: unknown, period: WorkforceTimecardPeriod): WorkforceTimesheetCounts | null {
  if (!record(value) || !record(value.policy) ||
      typeof value.policy.active !== "boolean" ||
      !["advisory", "block"].includes(String(value.policy.enforcementMode)) ||
      typeof value.manager !== "boolean" ||
      !Array.isArray(value.employees) || !Array.isArray(value.latest) ||
      !Array.isArray(value.history) || !Array.isArray(value.expectations)) return null;

  const employeeIds = new Set<number>();
  for (const worker of value.employees) {
    if (!record(worker) || !positiveId(worker.id) || employeeIds.has(worker.id) ||
        typeof worker.employeeNo !== "string" || typeof worker.name !== "string" ||
        (worker.orgUnitId !== null && !positiveId(worker.orgUnitId))) return null;
    employeeIds.add(worker.id);
  }

  const seenLatest = new Set<number>();
  const counts: WorkforceTimesheetCounts = {
    employees: employeeIds.size, approved: 0, submitted: 0, stale: 0, expectedMissing: 0, blockers: 0,
  };
  for (const row of value.latest) {
    if (!record(row) || !positiveId(row.id) || !positiveId(row.employeeId) ||
        !employeeIds.has(row.employeeId) || seenLatest.has(row.employeeId) ||
        row.periodStart !== period.periodStart || row.periodEnd !== period.periodEnd ||
        typeof row.status !== "string" || !TIMESHEET_STATUSES.has(row.status) ||
        typeof row.blockerCount !== "number" || !Number.isSafeInteger(row.blockerCount) || row.blockerCount < 0) return null;
    seenLatest.add(row.employeeId);
    if (row.status === "approved") counts.approved++;
    if (row.status === "submitted") counts.submitted++;
    if (row.status === "stale") counts.stale++;
    counts.blockers += row.blockerCount;
    if (!Number.isSafeInteger(counts.blockers)) return null;
  }

  const seenExpectations = new Set<string>();
  for (const expected of value.expectations) {
    if (!record(expected) || !positiveId(expected.id) || !positiveId(expected.payrollRunId) ||
        !positiveId(expected.employeeId) || !employeeIds.has(expected.employeeId) ||
        expected.periodStart !== period.periodStart || expected.periodEnd !== period.periodEnd ||
        typeof expected.status !== "string" || !EXPECTATION_STATUSES.has(expected.status)) return null;
    const key = String(expected.payrollRunId) + "/" + String(expected.employeeId);
    if (seenExpectations.has(key)) return null;
    seenExpectations.add(key);
    if (expected.status === "expected") counts.expectedMissing++;
  }
  return counts;
}

/** The manager metrics and payroll handoff share the same complete-source rule. */
export function verifiedWorkforceTimesheetCounts(
  response: unknown, period: WorkforceTimecardPeriod,
): WorkforceTimesheetCounts | null {
  const validPeriod = rememberWfmTimecardPeriod(undefined, period);
  return validPeriod ? readCounts(response, validPeriod) : null;
}

export function resolveWorkforcePayrollHandoff(input: Input): WorkforcePayrollHandoff {
  // Never reveal run IDs or their presence to manager/HR/worker-only or scoped reviewers.
  if (!positiveId(input.organizationId) || !positiveId(input.viewerId) ||
      input.access?.companyWide !== true ||
      !["owner", "admin", "bookkeeper", "payroll", "checker"].includes(input.access.role ?? "")) {
    return { kind: "restricted" };
  }
  // The existing payroll focus resolver honors this rollout gate too.
  if (!input.connectedNavigationEnabled) return { kind: "disabled" };
  const period = rememberWfmTimecardPeriod(undefined, input.period);
  if (!period || !Array.isArray(input.payrollRuns)) return { kind: "unverified" };
  const counts = verifiedWorkforceTimesheetCounts(input.timesheetResponse, period);
  if (!counts) return { kind: "unverified" };
  if (input.selectedLegalEntityId != null && !positiveId(input.selectedLegalEntityId)) {
    return { kind: "unverified" };
  }

  const runs: RunLink[] = [];
  const seenRuns = new Set<number>();
  for (const run of input.payrollRuns) {
    // Source dashboard returns real DB payroll runs with organization and legal-entity IDs.
    // Missing or foreign scope is not a reason to guess which employer/run to open.
    if (!record(run) || !positiveId(run.id) || seenRuns.has(run.id) ||
        run.organizationId !== input.organizationId ||
        typeof run.periodStart !== "string" || typeof run.periodEnd !== "string" ||
        !rememberWfmTimecardPeriod(undefined, {
          periodStart: run.periodStart, periodEnd: run.periodEnd,
        }) || typeof run.periodLabel !== "string" ||
        typeof run.scopeLabel !== "string" || typeof run.status !== "string") {
      return { kind: "unverified" };
    }
    seenRuns.add(run.id);
    if (input.selectedLegalEntityId != null && run.legalEntityId !== input.selectedLegalEntityId) {
      return { kind: "unverified" };
    }
    if (run.periodStart === period.periodStart && run.periodEnd === period.periodEnd) {
      runs.push({ id: run.id, periodLabel: run.periodLabel, scopeLabel: run.scopeLabel, status: run.status });
    }
  }
  // Multiple exact-period runs are deliberately all listed, never auto-selected.
  return { kind: "visible", counts, runs };
}
