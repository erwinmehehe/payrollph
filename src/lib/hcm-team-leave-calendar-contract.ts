/**
 * Read-only manager calendar of leave REQUEST spans. These are not verified
 * full-day absences or availability forecasts: precise interval evidence,
 * schedules, shifts and payroll treatment remain in their source workflows.
 */

export const TEAM_LEAVE_MONTHS_AHEAD = 6;
export const TEAM_LEAVE_SOURCE_CEILING = 400;

export type TeamLeaveScope =
  | { kind: "company"; orgUnitId: null }
  | { kind: "unit"; orgUnitId: number };

export type TeamLeaveStatus = "Approved" | "Pending";

export type TeamLeaveCase = {
  requestId: number;
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  status: TeamLeaveStatus;
  startDate: string;
  endDate: string;
};

export type TeamLeaveMonthResponse = {
  organizationId: number;
  scope: TeamLeaveScope;
  month: string;
  observedAt: string;
  dates: { start: string; end: string };
  cases: TeamLeaveCase[];
  summary: {
    approvedRequestRecords: number;
    pendingRequestRecords: number;
  };
  notice: string;
};

/** Same narrow entitlement shape as My Team. Null-unit managers fail closed. */
export function deriveTeamLeaveScope(
  access: { role: string; companyWide: boolean; orgUnitId: number | null } | null,
): TeamLeaveScope | null {
  if (!access) return null;
  const hr = ["owner", "admin", "hr"].includes(access.role);
  if (hr && access.companyWide) return { kind: "company", orgUnitId: null };
  if ((hr || access.role === "manager") && !access.companyWide &&
      Number.isSafeInteger(access.orgUnitId) && (access.orgUnitId ?? 0) > 0) {
    return { kind: "unit", orgUnitId: access.orgUnitId! };
  }
  return null;
}

/** Do not use local browser TZ for leave date-only values. */
export function currentPhilippineMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month");
}

export function monthShift(month: string, offset: number) {
  if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month) ||
      !Number.isInteger(offset) || Math.abs(offset) > 120) {
    throw new Error("Expected YYYY-MM with a bounded month offset.");
  }
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function isPermittedTeamLeaveMonth(month: string, now = new Date()) {
  if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) return false;
  const current = currentPhilippineMonth(now);
  return month >= current && month <= monthShift(current, TEAM_LEAVE_MONTHS_AHEAD);
}

export function teamLeaveMonthWindow(month: string) {
  if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Calendar month must use YYYY-MM.");
  }
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
  return { start: month + "-01", end: last };
}

/** Fixed 6-week Monday-first grid: null cells are not part of the month. */
export function teamLeaveMonthCells(month: string): Array<string | null> {
  const { start, end } = teamLeaveMonthWindow(month);
  const firstWeekday = (new Date(start + "T00:00:00Z").getUTCDay() + 6) % 7;
  const days = Number(end.slice(-2));
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= days ? month + "-" + String(day).padStart(2, "0") : null;
  });
}

export function activeLeaveRequestSpans(
  date: string,
  cases: readonly TeamLeaveCase[],
): TeamLeaveCase[] {
  return cases.filter((entry) => entry.startDate <= date && entry.endDate >= date);
}

export function summarizeTeamLeaveMonth(cases: readonly Pick<TeamLeaveCase, "status">[]) {
  return {
    approvedRequestRecords: cases.filter((item) => item.status === "Approved").length,
    pendingRequestRecords: cases.filter((item) => item.status === "Pending").length,
  };
}
