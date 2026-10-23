import type { AssuranceFinding } from "./payroll-assurance";
import { isCanonicalPhSemiMonthlyPeriod } from "./payroll-calendar";
import type { RuleWatchItem, RuleWatchStatus } from "./statutory-rule-watch";

/**
 * Phase 1 only. Source readiness BEFORE the payroll engine runs, distinct from
 * the existing post-calculation/release AssuranceFinding codes and release gate.
 * No writes, AI explanations or provider calls are performed here.
 */
export type PreRunEmployee = {
  id: number;
  employeeNo: string;
  legalEntityId: number | null;
};
export type PreRunTimesheet = {
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  version: number;
  status: string;
  decidedAt: Date | string | null;
};
export type PreRunReadinessInput = {
  run: {
    id: number;
    organizationId: number;
    legalEntityId: number | null;
    periodStart: string;
    periodEnd: string;
    payDate: string;
  };
  employer: { id: number; payrollCalendarMode: string; active: boolean } | null;
  employees: readonly PreRunEmployee[];
  profiles: readonly { employeeId: number }[];
  timesheets: readonly PreRunTimesheet[];
  punchEmployees: readonly { employeeId: number }[];
  attendanceCorrections: readonly { employeeId: number; workDate: string; status: string }[];
  restDayRevisions: readonly { employeeId: number; effectiveDate: string; createdAt: Date | string }[];
  scheduleAssignments: readonly { employeeId: number; effectiveFrom: string; createdAt: Date | string }[];
  scheduleOverrides: readonly { employeeId: number; workDate: string; status: string }[];
  scheduleSwaps: readonly {
    requesterEmployeeId: number;
    counterpartyEmployeeId: number;
    requesterWorkDate: string;
    counterpartyWorkDate: string;
    status: string;
  }[];
  periodConflict: { id: number; periodLabel: string; status: string } | null;
  ruleWatch: readonly RuleWatchItem[];
};
export type PayrollPreRunReadiness = {
  organizationId: number;
  legalEntityId: number | null;
  runId: number;
  ready: boolean;
  findings: AssuranceFinding[];
  summary: { high: number; medium: number; info: number; blocking: number };
};

const BLOCKING_STATUSES: Partial<Record<RuleWatchStatus, string>> = {
  "verification-unrecorded": "PRERUN_STATUTORY_VERIFICATION_UNRECORDED",
  "review-due": "PRERUN_STATUTORY_REVIEW_DUE",
  "update-overdue": "PRERUN_STATUTORY_UPDATE_OVERDUE",
  "no-coverage": "PRERUN_STATUTORY_NO_COVERAGE",
};
const USED_STATUTORY_FAMILIES = new Set([
  "sss", "philhealth", "pagibig", "bir-withholding", "wage-orders",
]);

function isoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function instant(value: Date | string | null): number {
  if (!value) return -Infinity;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : -Infinity;
}
function during(day: string, start: string, end: string) {
  return day >= start && day <= end;
}

/** Pure deterministic evaluation: accepts only tenant/run-scoped, read-only evidence. */
export function evaluatePayrollPreRunReadiness(input: PreRunReadinessInput): PayrollPreRunReadiness {
  const { run, employer, employees, ruleWatch } = input;
  const findings: AssuranceFinding[] = [];
  const add = (code: string, title: string, detail: string, employeeId?: number) => {
    findings.push({ code, severity: "high", blocking: true, title, detail,
      ...(employeeId === undefined ? {} : { employeeId }) });
  };

  if (!isoDay(run.periodStart) || !isoDay(run.periodEnd) || run.periodStart > run.periodEnd) {
    add("PRERUN_INVALID_PERIOD", "Invalid payroll period",
      "The period must contain valid ISO dates in chronological order.");
  }
  if (!isoDay(run.payDate)) {
    add("PRERUN_INVALID_PAY_DATE", "Invalid pay date",
      "The pay date must be a valid ISO calendar date.");
  } else if (isoDay(run.periodEnd) && run.payDate < run.periodEnd) {
    add("PRERUN_PAY_DATE_BEFORE_END", "Pay date precedes the cutoff",
      "The payment date cannot be earlier than the payroll period end.");
  }
  if (!run.legalEntityId || !employer || !employer.active || employer.id !== run.legalEntityId) {
    add("PRERUN_EMPLOYER_UNRESOLVED", "Payroll legal employer is unresolved",
      "Select an active, organization-owned legal employer before calculating.");
  } else if (employer.payrollCalendarMode === "ph_semi_monthly"
    && !isCanonicalPhSemiMonthlyPeriod(run.periodStart, run.periodEnd)) {
    add("PRERUN_NONCANONICAL_PERIOD", "Period does not match employer's calendar",
      "This employer requires the Philippine 1-15 or 16-month-end semi-monthly cutoff.");
  }
  if (input.periodConflict) {
    add("PRERUN_PERIOD_OVERLAP", "Overlapping payroll period",
      "Run #" + input.periodConflict.id + " (" + input.periodConflict.periodLabel
        + ") already covers the same legal employer and overlapping population ("
        + input.periodConflict.status + ").");
  }
  if (!employees.length) {
    add("PRERUN_NO_EMPLOYEES", "No employees in this payroll run",
      "There are no active employees starting on or before this cutoff within this run's scope.");
  }

  // The payroll engine resolves these four packs on every populated run, even
  // when a particular employee's resulting statutory deduction is zero.
  if (employees.length) {
    for (const item of ruleWatch) {
      if (!USED_STATUTORY_FAMILIES.has(item.family)) continue;
      const code = BLOCKING_STATUSES[item.status];
      if (!code) continue;
      add(code, item.label + " requires verification",
        item.family + " (" + item.status + "): " + item.detail
          + " Rule version: " + (item.currentVersion ?? "none")
          + "; source: " + (item.sourceDocument ?? "unrecorded") + ".");
    }
  }

  const profileIds = new Set(input.profiles.map(p => p.employeeId));
  const punchIds = new Set(input.punchEmployees.map(p => p.employeeId));
  const latestTimesheets = new Map<number, PreRunTimesheet>();
  for (const sheet of input.timesheets) {
    const old = latestTimesheets.get(sheet.employeeId);
    if (!old || sheet.version > old.version) latestTimesheets.set(sheet.employeeId, sheet);
  }

  for (const employee of employees) {
    const id = employee.id;
    const label = "Employee " + employee.employeeNo;
    const sheet = latestTimesheets.get(id);
    const approved = sheet?.status === "approved"
      && sheet.periodStart === run.periodStart && sheet.periodEnd === run.periodEnd;
    const pendingCorrection = input.attendanceCorrections.some(row =>
      row.employeeId === id && row.status === "pending"
        && during(row.workDate, run.periodStart, run.periodEnd));
    if (run.legalEntityId != null && employee.legalEntityId === null) {
      add("PRERUN_LEGAL_ENTITY_UNASSIGNED", "Employee has no legal employer",
        label + " must be assigned to a legal employer before calculation.", id);
    }
    if (!profileIds.has(id)) {
      add("PRERUN_PAY_PROFILE_MISSING", "Employee pay profile missing",
        label + " has no saved pay-basis/rate profile for the payroll engine.", id);
    }
    if (pendingCorrection || sheet?.status === "stale") {
      add("PRERUN_ATTENDANCE_STALE", "Attendance evidence is stale or pending",
        label + " has a stale timesheet or an unresolved attendance correction in this cutoff.", id);
    } else if (!approved) {
      add(punchIds.has(id) ? "PRERUN_ATTENDANCE_UNREVIEWED" : "PRERUN_ATTENDANCE_MISSING",
        "Period attendance is not approved",
        label + (punchIds.has(id)
          ? " has punches but no approved current-period timesheet."
          : " has no punches or approved current-period timesheet."), id);
    }

    // Rest-day revision rows and schedule assignments have no pending-status
    // column. A subsequent independently approved timesheet is their evidence
    // of resolution; otherwise a mid-period change must be reviewed first.
    const resolvedAfter = (createdAt: Date | string) =>
      approved && sheet?.decidedAt != null && instant(sheet.decidedAt) >= instant(createdAt);
    const restDayPending = input.restDayRevisions.some(row =>
      row.employeeId === id && run.periodStart < row.effectiveDate
        && row.effectiveDate <= run.periodEnd && !resolvedAfter(row.createdAt));
    if (restDayPending) {
      add("PRERUN_REST_DAY_REVISION_UNRESOLVED", "Mid-period rest-day revision needs review",
        label + " has a rest-day change effective inside the cutoff without a later approved timesheet.", id);
    }
    const schedulePending = input.scheduleAssignments.some(row =>
      row.employeeId === id && run.periodStart < row.effectiveFrom
        && row.effectiveFrom <= run.periodEnd && !resolvedAfter(row.createdAt));
    const overridePending = input.scheduleOverrides.some(row =>
      row.employeeId === id && row.status === "pending"
        && during(row.workDate, run.periodStart, run.periodEnd));
    const swapPending = input.scheduleSwaps.some(row => row.status === "pending" &&
      ((row.requesterEmployeeId === id
        && during(row.requesterWorkDate, run.periodStart, run.periodEnd))
        || (row.counterpartyEmployeeId === id
          && during(row.counterpartyWorkDate, run.periodStart, run.periodEnd))));
    if (schedulePending || overridePending || swapPending) {
      add("PRERUN_SCHEDULE_REVISION_UNRESOLVED", "Mid-period schedule change needs review",
        label + " has a mid-period assignment or pending override/swap that requires resolution before calculating.", id);
    }
  }

  return {
    organizationId: run.organizationId,
    legalEntityId: run.legalEntityId,
    runId: run.id,
    findings,
    ready: !findings.some(f => f.blocking),
    summary: {
      high: findings.filter(f => f.severity === "high").length,
      medium: findings.filter(f => f.severity === "medium").length,
      info: findings.filter(f => f.severity === "info").length,
      blocking: findings.filter(f => f.blocking).length,
    },
  };
}
