/**
 * Payroll-connected SOURCE READINESS — gated release policy.
 *
 * Unlike the HRIS/WFM/HCM advisory dashboard, a release decision is anchored
 * to the LAST COMPLETED CALCULATION and only considers the payroll population.
 * Never classify an ordinary pay revision as unauthorized solely for lacking
 * an HCM proposal: legacy finance-approved revisions remain valid sources.
 *
 * Pure policy only; authorization, database isolation, employee selection and
 * immutable financial settlement are independently enforced by the callers.
 */
export type ConnectedReleaseArea = "HRIS" | "WFM" | "HCM" | "integrity";
export type ConnectedReleaseSeverity = "blocker" | "review";
export type ConnectedReleaseFinding = {
  code: string;
  area: ConnectedReleaseArea;
  severity: ConnectedReleaseSeverity;
  employeeId?: number;
  sourceId?: number;
  detail: string;
};

type DatedWorkerChange = {
  id: number;
  employeeId: number;
  status: string;
  effectiveDate: string;
  appliedAt: Date | string | null;
};
type PayoutChange = {
  id: number;
  employeeId: number;
  status: string;
  appliedAt: Date | string | null;
};
type AttendanceCorrection = {
  id: number;
  employeeId: number;
  status: string;
  workDate: string;
  appliedAt: Date | string | null;
};
type AttendanceException = {
  id: number;
  employeeId: number;
  workDate: string;
  status: string;
  severity: string;
};
type TimesheetVersion = {
  id: number;
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  version: number;
  status: string;
};
type HcmProposal = {
  id: number;
  employeeId: number;
  status: string;
  effectiveDate: string;
  appliedAt: Date | string | null;
};
type EffectiveRevision = {
  id: number;
  employeeId: number;
  effectiveDate: string;
  createdAt: Date | string;
};

export type ConnectedReleaseInput = {
  periodStart: string;
  periodEnd: string;
  /** Null signals missing or invalid completed calculation evidence. */
  calculatedAt: Date | string | null;
  calculatedEmployeeIds: number[];
  expectedEmployeeIds: number[];
  workerChanges?: DatedWorkerChange[];
  payoutChanges?: PayoutChange[];
  attendanceCorrections?: AttendanceCorrection[];
  attendanceExceptions?: AttendanceException[];
  timesheets?: TimesheetVersion[];
  compensationProposals?: HcmProposal[];
  payRevisions?: EffectiveRevision[];
  restDayRevisions?: EffectiveRevision[];
  truncatedSources?: string[];
};

export type ConnectedReleaseResult = {
  version: "connected-payroll-release-v1";
  ready: boolean;
  incomplete: boolean;
  blockingCount: number;
  reviewCount: number;
  findings: ConnectedReleaseFinding[];
};

const MAX_FINDINGS = 100;
const CANCELLED = new Set(["cancelled", "canceled", "rejected", "declined", "voided", "superseded"]);
const PENDING = new Set(["pending", "pending_approval", "scheduled", "failed"]);
const SETTLED = new Set(["approved", "applied"]);

const lower = (s: string) => String(s ?? "").trim().toLowerCase();
const timestamp = (value: Date | string | null | undefined) => {
  if (value == null) return null;
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(milliseconds) ? milliseconds : null;
};
const validDate = (value: string) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export function evaluatePayrollConnectedRelease(input: ConnectedReleaseInput): ConnectedReleaseResult {
  const findings: ConnectedReleaseFinding[] = [];
  const add = (code: string, area: ConnectedReleaseArea, severity: ConnectedReleaseSeverity,
    detail: string, employeeId?: number, sourceId?: number) => {
    findings.push({ code, area, severity, detail, employeeId, sourceId });
  };

  const cutoffValid = validDate(input.periodStart) && validDate(input.periodEnd)
    && input.periodStart <= input.periodEnd;
  if (!cutoffValid) add("INVALID_PAYROLL_PERIOD", "integrity", "blocker", "Payroll period dates are invalid.");

  const calculatedAt = timestamp(input.calculatedAt);
  if (calculatedAt == null) {
    add("PAYROLL_CALCULATION_TIME_MISSING", "integrity", "blocker",
      "A completed payroll calculation timestamp is missing or invalid. Recalculate the run before release.");
  }
  const changedAfterCalculation = (value: Date | string | null | undefined) => {
    const time = timestamp(value);
    return calculatedAt != null && time != null && time > calculatedAt;
  };

  const enrolled = new Set(input.calculatedEmployeeIds);
  const expected = new Set(input.expectedEmployeeIds);
  if (enrolled.size !== input.calculatedEmployeeIds.length
    || expected.size !== input.expectedEmployeeIds.length
    || [...enrolled, ...expected].some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    add("PAYROLL_POPULATION_INVALID", "integrity", "blocker",
      "Payroll employee scope is missing, duplicated, or invalid. Rebuild employee coverage.");
  }
  const missing = [...expected].filter((id) => !enrolled.has(id));
  const extra = [...enrolled].filter((id) => !expected.has(id));
  for (const id of missing) {
    add("PAYROLL_ELIGIBLE_EMPLOYEE_MISSING", "HRIS", "blocker",
      "A currently eligible employee is missing from the calculated payroll register.", id);
  }
  for (const id of extra) {
    add("PAYROLL_INELIGIBLE_EMPLOYEE_INCLUDED", "HRIS", "blocker",
      "A payroll entry no longer matches the live eligible employee population. Verify effective dates and recalculate.", id);
  }

  // A release guard must never ignore rows because the source paging budget was hit.
  const truncatedSources = [...new Set(input.truncatedSources ?? [])];
  for (const source of truncatedSources) add("CONNECTED_SOURCE_INCOMPLETE", "integrity", "blocker",
    "Upstream source evidence is incomplete: " + source + ". Review with a paged query before release.");

  // The server must also scope every source read by employee; filtering here
  // prevents accidental overblocking from unrelated departments.
  const affectsPayroll = (id: number) => enrolled.has(id);

  for (const row of input.workerChanges ?? []) {
    if (!affectsPayroll(row.employeeId) || !validDate(row.effectiveDate) || row.effectiveDate > input.periodEnd) continue;
    const state = lower(row.status);
    if (PENDING.has(state)) {
      add("HRIS_EFFECTIVE_CHANGE_NOT_APPLIED", "HRIS", "blocker",
        "A pay-period-effective employee change is pending, scheduled or failed.", row.employeeId, row.id);
    } else if (state === "applied" && changedAfterCalculation(row.appliedAt)) {
      add("HRIS_CHANGE_AFTER_CALCULATION", "HRIS", "blocker",
        "An employee change was applied after payroll was calculated. Recalculate and obtain a new checker approval.", row.employeeId, row.id);
    } else if (state === "applied" && !row.appliedAt) {
      add("HRIS_APPLIED_EVIDENCE_MISSING", "HRIS", "blocker",
        "An applied employee change lacks its application receipt.", row.employeeId, row.id);
    }
  }

  for (const row of input.payoutChanges ?? []) {
    if (!affectsPayroll(row.employeeId)) continue;
    const state = lower(row.status);
    const hasAppliedEvidence = timestamp(row.appliedAt) != null;
    if (PENDING.has(state) || (SETTLED.has(state) && !hasAppliedEvidence)
      || (CANCELLED.has(state) && hasAppliedEvidence)) {
      add("HRIS_PAYOUT_APPROVAL_UNRESOLVED", "HRIS", "blocker",
        "The employee payout destination change remains unresolved or its approval/application evidence is inconsistent.", row.employeeId, row.id);
    } else if (SETTLED.has(state) && changedAfterCalculation(row.appliedAt)) {
      add("HRIS_PAYOUT_CHANGED_AFTER_CALCULATION", "HRIS", "blocker",
        "The employee payout destination changed after calculation. Re-run payee/preflight verification and refresh the payroll snapshot.", row.employeeId, row.id);
    }
  }

  for (const row of input.attendanceCorrections ?? []) {
    if (!affectsPayroll(row.employeeId) || !validDate(row.workDate)
      || row.workDate < input.periodStart || row.workDate > input.periodEnd) continue;
    const state = lower(row.status);
    const hasAppliedEvidence = timestamp(row.appliedAt) != null;
    if (PENDING.has(state) || (SETTLED.has(state) && !hasAppliedEvidence)
      || (CANCELLED.has(state) && hasAppliedEvidence)) {
      add("WFM_CORRECTION_UNRESOLVED", "WFM", "blocker",
        "An attendance correction for this period is unresolved or missing its application evidence.", row.employeeId, row.id);
    } else if (SETTLED.has(state) && changedAfterCalculation(row.appliedAt)) {
      add("WFM_CORRECTION_AFTER_CALCULATION", "WFM", "blocker",
        "An attendance correction was applied after calculation. Recalculate affected hours and secure fresh approval.", row.employeeId, row.id);
    }
  }

  for (const row of input.attendanceExceptions ?? []) {
    if (!affectsPayroll(row.employeeId) || lower(row.status) !== "open"
      || !validDate(row.workDate) || row.workDate < input.periodStart
      || row.workDate > input.periodEnd) continue;
    const blocking = lower(row.severity) === "blocker";
    add(blocking ? "WFM_ATTENDANCE_BLOCKER" : "WFM_ATTENDANCE_REVIEW",
      "WFM", blocking ? "blocker" : "review",
      "Open attendance exception requires a manager/payroll review before period close.", row.employeeId, row.id);
  }

  const timesheetByEmployee = new Map<number, TimesheetVersion>();
  for (const row of input.timesheets ?? []) {
    if (!affectsPayroll(row.employeeId) || row.periodStart !== input.periodStart
      || row.periodEnd !== input.periodEnd || !Number.isSafeInteger(row.version)) continue;
    const last = timesheetByEmployee.get(row.employeeId);
    if (!last || row.version > last.version || (row.version === last.version && row.id > last.id)) {
      timesheetByEmployee.set(row.employeeId, row);
    }
  }
  for (const row of timesheetByEmployee.values()) {
    if (lower(row.status) !== "approved") add("WFM_LATEST_TIMESHEET_NOT_APPROVED",
      "WFM", "blocker", "The latest timesheet is not approved for this cutoff.", row.employeeId, row.id);
  }

  for (const row of input.compensationProposals ?? []) {
    if (!affectsPayroll(row.employeeId) || !validDate(row.effectiveDate)
      || row.effectiveDate > input.periodEnd) continue;
    const state = lower(row.status);
    if (state === "scheduled" || state === "approved" || state === "failed") {
      add("HCM_COMPENSATION_NOT_APPLIED", "HCM", "blocker",
        "An approved/scheduled effective-dated compensation change has not been safely applied.", row.employeeId, row.id);
    } else if (state === "applied" && changedAfterCalculation(row.appliedAt)) {
      add("HCM_COMPENSATION_CHANGED_AFTER_CALCULATION", "HCM", "blocker",
        "Compensation changed after payroll calculation. Recalculate and obtain a new checker approval.", row.employeeId, row.id);
    } else if (state === "applied" && !row.appliedAt) {
      add("HCM_COMPENSATION_APPLIED_EVIDENCE_MISSING", "HCM", "blocker",
        "An applied compensation proposal has no application receipt.", row.employeeId, row.id);
    } else if (state === "proposed" || state === "pending_approval") {
      add("HCM_COMPENSATION_PROPOSAL_REVIEW", "HCM", "review",
        "A salary proposal has not been authorized. Do not treat the proposed amount as payable.", row.employeeId, row.id);
    }
  }

  const revision = (row: EffectiveRevision, area: ConnectedReleaseArea, code: string) => {
    if (!affectsPayroll(row.employeeId) || !validDate(row.effectiveDate)
      || row.effectiveDate > input.periodEnd) return;
    if (changedAfterCalculation(row.createdAt)) {
      add(code, area, "blocker",
        "A retroactive or current-period revision was recorded after this payroll calculation. Recalculate affected pay/shift premiums.", row.employeeId, row.id);
    }
  };
  for (const row of input.payRevisions ?? []) revision(row, "HCM", "HCM_PAY_REVISION_AFTER_CALCULATION");
  for (const row of input.restDayRevisions ?? []) revision(row, "WFM", "WFM_REST_DAY_AFTER_CALCULATION");

  // Stable ordering makes inspection and future reviewer fingerprinting safe.
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocker" ? -1 : 1)
    || a.area.localeCompare(b.area) || a.code.localeCompare(b.code)
    || (a.employeeId ?? 0) - (b.employeeId ?? 0) || (a.sourceId ?? 0) - (b.sourceId ?? 0));
  const blockingCount = findings.filter((f) => f.severity === "blocker").length;
  const reviewCount = findings.length - blockingCount;
  return {
    version: "connected-payroll-release-v1",
    ready: blockingCount === 0 && calculatedAt != null && cutoffValid,
    incomplete: truncatedSources.length > 0,
    blockingCount,
    reviewCount,
    findings: findings.slice(0, MAX_FINDINGS),
  };
}
