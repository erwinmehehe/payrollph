export type HrReadinessIssueKey =
  | "bank_details"
  | "government_ids"
  | "employment_dates"
  | "pay_basis"
  | "attendance"
  | "leave_overlap"
  | "rest_day"
  | "onboarding";

export type HrReadinessAction = "employee" | "attendance" | "leave" | "separation";

export type HrReadinessIssue = {
  key: HrReadinessIssueKey;
  label: string;
  detail: string;
  action: HrReadinessAction;
};

export type HrReadinessEmployee = {
  id: number;
  firstName: string;
  lastName: string;
  employeeNo: string;
  status: string;
  startDate?: string | null;
  bankAccount?: string | null;
  bankCode?: string | null;
  tin?: string | null;
  tinBranchCode?: string | null;
  sssNo?: string | null;
  philHealthNo?: string | null;
  pagIbigNo?: string | null;
  payBasis?: string | null;
  payRate?: string | number | null;
  standardWorkDaysPerMonth?: string | number | null;
  standardHoursPerDay?: string | number | null;
  restDay?: string | null;
};

export type HrReadinessPunch = {
  employeeId: number;
  workDate: string;
  status: string;
};

export type HrReadinessLeave = {
  id: number;
  employeeId: number;
  startDate: string;
  endDate: string;
  status: string;
};

export type HrReadinessProvisioning = {
  employeeId: number;
  kind: string;
  done: boolean;
  title: string;
};

export type HrReadinessSeparation = {
  employeeId: number;
  noticeDate: string;
  lastDay: string;
  status: string;
};

export type HrReadinessPeriod = {
  periodStart: string;
  periodEnd: string;
  periodLabel?: string;
} | null;

export type HrReadinessRow = {
  employeeId: number;
  employeeName: string;
  employeeNo: string;
  employeeStatus: string;
  ready: boolean;
  issues: HrReadinessIssue[];
};

const inactiveStatuses = new Set(["inactive", "terminated", "separated"]);
const acceptablePunchStatuses = new Set(["complete", "present", "ok", "approved"]);
const ignoredLeaveStatuses = new Set(["declined", "rejected", "cancelled", "canceled"]);

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function inPeriod(date: string, period: HrReadinessPeriod) {
  if (!period) return true;
  return date >= period.periodStart && date <= period.periodEnd;
}

function overlaps(a: HrReadinessLeave, b: HrReadinessLeave) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

function activeLeaveRows(rows: HrReadinessLeave[], period: HrReadinessPeriod) {
  return rows.filter((leave) =>
    !ignoredLeaveStatuses.has(leave.status.toLowerCase()) &&
    (!period || (leave.startDate <= period.periodEnd && leave.endDate >= period.periodStart))
  );
}

export function buildHrPayrollReadiness(input: {
  employees: HrReadinessEmployee[];
  punches?: HrReadinessPunch[];
  leaveRequests?: HrReadinessLeave[];
  provisioning?: HrReadinessProvisioning[];
  separations?: HrReadinessSeparation[];
  period?: HrReadinessPeriod;
}) {
  const period = input.period ?? null;
  const punches = input.punches ?? [];
  const leaveRequests = input.leaveRequests ?? [];
  const provisioning = input.provisioning ?? [];
  const separations = input.separations ?? [];

  const rows: HrReadinessRow[] = [];

  for (const employee of input.employees) {
    if (inactiveStatuses.has(employee.status.toLowerCase())) continue;
    if (period && employee.startDate && employee.startDate > period.periodEnd) continue;

    const issues: HrReadinessIssue[] = [];

    if (!employee.bankAccount || !employee.bankCode) {
      issues.push({
        key: "bank_details",
        label: "Payout details",
        detail: !employee.bankAccount && !employee.bankCode
          ? "Bank/payout account and payout code are missing."
          : !employee.bankAccount
            ? "Bank/payout account is missing."
            : "Bank/payout code is missing.",
        action: "employee",
      });
    }

    const missingGovernment = [
      ["TIN", employee.tin],
      ["BIR branch code", employee.tinBranchCode],
      ["SSS", employee.sssNo],
      ["PhilHealth", employee.philHealthNo],
      ["Pag-IBIG", employee.pagIbigNo],
    ].filter(([, value]) => !value).map(([label]) => label);

    if (missingGovernment.length) {
      issues.push({
        key: "government_ids",
        label: "Government IDs",
        detail: `Missing ${missingGovernment.join(", ")}.`,
        action: "employee",
      });
    }

    const separation = separations.find((row) => row.employeeId === employee.id);
    if (!employee.startDate) {
      issues.push({
        key: "employment_dates",
        label: "Employment dates",
        detail: "Employment start date is missing.",
        action: "employee",
      });
    } else if (employee.status.toLowerCase() === "separating" && !separation) {
      issues.push({
        key: "employment_dates",
        label: "Employment dates",
        detail: "Employee is marked Separating but has no separation notice/last-day record.",
        action: "separation",
      });
    } else if (separation && separation.lastDay < separation.noticeDate) {
      issues.push({
        key: "employment_dates",
        label: "Employment dates",
        detail: "Separation last day is earlier than the recorded notice date.",
        action: "separation",
      });
    }

    const payBasis = (employee.payBasis ?? "").toLowerCase();
    if (
      !["monthly", "daily", "hourly"].includes(payBasis) ||
      !finitePositive(employee.payRate) ||
      !finitePositive(employee.standardWorkDaysPerMonth) ||
      !finitePositive(employee.standardHoursPerDay)
    ) {
      issues.push({
        key: "pay_basis",
        label: "Pay basis",
        detail: "Pay basis, rate, standard work days, or standard hours is incomplete.",
        action: "employee",
      });
    }

    if (!employee.restDay) {
      issues.push({
        key: "rest_day",
        label: "Rest day",
        detail: "Weekly rest day is not configured, so rest-day premium treatment cannot be determined safely.",
        action: "employee",
      });
    }

    const employeePunches = punches.filter((punch) => punch.employeeId === employee.id && inPeriod(punch.workDate, period));
    const badPunches = employeePunches.filter((punch) => !acceptablePunchStatuses.has(punch.status.toLowerCase()));
    if (period && employeePunches.length === 0) {
      issues.push({
        key: "attendance",
        label: "Attendance",
        detail: `No attendance records are loaded for ${period.periodLabel ?? "the payroll period"}.`,
        action: "attendance",
      });
    } else if (badPunches.length) {
      issues.push({
        key: "attendance",
        label: "Attendance",
        detail: `${badPunches.length} attendance record${badPunches.length === 1 ? "" : "s"} need context or correction.`,
        action: "attendance",
      });
    }

    const employeeLeave = activeLeaveRows(
      leaveRequests.filter((leave) => leave.employeeId === employee.id),
      period,
    );
    let overlapCount = 0;
    for (let i = 0; i < employeeLeave.length; i += 1) {
      for (let j = i + 1; j < employeeLeave.length; j += 1) {
        if (overlaps(employeeLeave[i], employeeLeave[j])) overlapCount += 1;
      }
    }
    if (overlapCount) {
      issues.push({
        key: "leave_overlap",
        label: "Leave overlap",
        detail: `${overlapCount} overlapping leave request pair${overlapCount === 1 ? "" : "s"} need review.`,
        action: "leave",
      });
    }

    const onboarding = provisioning.filter(
      (task) => task.employeeId === employee.id && !task.done && task.kind.toLowerCase() === "onboarding",
    );
    if (onboarding.length) {
      issues.push({
        key: "onboarding",
        label: "Onboarding",
        detail: `${onboarding.length} onboarding task${onboarding.length === 1 ? "" : "s"} remain open.`,
        action: "employee",
      });
    }

    rows.push({
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      employeeStatus: employee.status,
      ready: issues.length === 0,
      issues,
    });
  }

  const issueCounts: Record<HrReadinessIssueKey, number> = {
    bank_details: 0,
    government_ids: 0,
    employment_dates: 0,
    pay_basis: 0,
    attendance: 0,
    leave_overlap: 0,
    rest_day: 0,
    onboarding: 0,
  };
  for (const row of rows) {
    for (const issue of row.issues) issueCounts[issue.key] += 1;
  }

  const ready = rows.filter((row) => row.ready).length;
  return {
    period,
    rows,
    ready,
    total: rows.length,
    blocked: rows.length - ready,
    issueCounts,
    issueTotal: rows.reduce((sum, row) => sum + row.issues.length, 0),
  };
}
