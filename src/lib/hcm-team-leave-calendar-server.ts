import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveRequests, orgUnits } from "@/db/schema";
import {
  isPermittedTeamLeaveMonth,
  summarizeTeamLeaveMonth,
  TEAM_LEAVE_SOURCE_CEILING,
  teamLeaveMonthWindow,
  type TeamLeaveCase,
  type TeamLeaveMonthResponse,
  type TeamLeaveScope,
} from "@/lib/hcm-team-leave-calendar-contract";

export class TeamLeaveScopeError extends Error {
  constructor() { super("Assigned organization unit is missing, inactive or not effective."); }
}
export class TeamLeaveSourceOverflowError extends Error {
  constructor() { super("Month has more source records than this bounded calendar can display."); }
}
export class TeamLeaveInvalidMonthError extends Error {
  constructor() { super("Calendar month must be current or within six months ahead."); }
}

function philippineDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return [get("year"), get("month"), get("day")].join("-");
}

/**
 * Read-only, bounded leave request date-range projection.
 *
 * Company/manager scope is authorized by the route, then re-verified here
 * against current employer/unit evidence. No leave type, reason, precise
 * interval clock times, payroll treatment or personal employee metadata.
 */
export async function loadTeamLeaveMonth(input: {
  organizationId: number; scope: TeamLeaveScope; month: string;
  now?: Date;
}): Promise<TeamLeaveMonthResponse> {
  const { organizationId, scope, month } = input;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      (scope.kind === "unit" &&
        (!Number.isSafeInteger(scope.orgUnitId) || scope.orgUnitId <= 0))) {
    throw new TeamLeaveScopeError();
  }
  const now = input.now ?? new Date();
  if (!isPermittedTeamLeaveMonth(month, now)) throw new TeamLeaveInvalidMonthError();

  if (scope.kind === "unit") {
    const today = philippineDate(now);
    const [active] = await db.select({ id: orgUnits.id }).from(orgUnits)
      .where(and(
        eq(orgUnits.id, scope.orgUnitId),
        eq(orgUnits.organizationId, organizationId),
        eq(orgUnits.active, true),
        or(isNull(orgUnits.effectiveFrom), lte(orgUnits.effectiveFrom, today)),
        or(isNull(orgUnits.effectiveUntil), gte(orgUnits.effectiveUntil, today)),
      )).limit(1);
    if (!active) throw new TeamLeaveScopeError();
  }

  const dates = teamLeaveMonthWindow(month);
  const query = [
    eq(leaveRequests.organizationId, organizationId),
    inArray(leaveRequests.status, ["Approved", "Pending"]),
    lte(leaveRequests.startDate, dates.end),
    gte(leaveRequests.endDate, dates.start),
  ];
  if (scope.kind === "unit") query.push(eq(employees.orgUnitId, scope.orgUnitId));

  const rows = await db.select({
    id: leaveRequests.id,
    employeeId: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    status: leaveRequests.status,
    startDate: leaveRequests.startDate,
    endDate: leaveRequests.endDate,
  }).from(leaveRequests)
    .innerJoin(employees, and(
      eq(employees.id, leaveRequests.employeeId),
      eq(employees.organizationId, organizationId),
    ))
    .where(and(...query))
    .orderBy(asc(leaveRequests.startDate), asc(leaveRequests.id))
    .limit(TEAM_LEAVE_SOURCE_CEILING + 1);

  // Never pretend a truncated snapshot is the complete month.
  if (rows.length > TEAM_LEAVE_SOURCE_CEILING) throw new TeamLeaveSourceOverflowError();

  const cases: TeamLeaveCase[] = rows.map((row) => {
    const startDate = String(row.startDate);
    const endDate = String(row.endDate);
    if (startDate > endDate ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new TeamLeaveScopeError();
    }
    return {
      requestId: row.id,
      employeeId: row.employeeId,
      employeeNo: row.employeeNo,
      employeeName: [row.firstName, row.lastName].filter(Boolean).join(" "),
      status: row.status as "Approved" | "Pending",
      startDate,
      endDate,
    };
  });

  return {
    organizationId,
    scope,
    month,
    observedAt: now.toISOString(),
    dates,
    cases,
    summary: summarizeTeamLeaveMonth(cases),
    notice: "Current-employer leave request spans only; approvals are recorded source statuses. A date-range overlap does not prove full-day absence, shift coverage, headcount capacity, paid leave, or workforce availability. Precise leave intervals stay in the authoritative workflow.",
  };
}
