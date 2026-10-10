import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, orgUnits, timePunches } from "@/db/schema";
import type { MyTeamScope } from "@/lib/hcm-my-team-contract";
import { loadResolvedEmployeeSchedule } from "@/lib/workforce-schedule-evidence-server";
import {
  classifyTeamAttendance, summarizeTeamAttendance,
  type TeamAttendanceDay, type TeamAttendanceResponse,
} from "@/lib/hcm-team-attendance-preview";

const PAGE_SIZE = 10;
const PUNCH_CAP = 500;

export class InvalidTeamAttendanceScopeError extends Error {
  constructor() { super("The supervisory unit is invalid, inactive or not currently effective."); }
}
export class TeamAttendanceSourceOverflowError extends Error {
  constructor() { super("Source punch record ceiling exceeded; partial attendance evidence cannot be displayed."); }
}

/** Calendar arithmetic must be independent of server and browser locale. */
export function philippineBusinessDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (field: string) => parts.find(part => part.type === field)?.value ?? "";
  const result = [value("year"), value("month"), value("day")].join("-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error("Invalid Philippine business date.");
  return result;
}

/**
 * A bounded current-day preview based only on existing WFM sources.
 * The API must authorize active membership, session and workforce.manage first.
 * Tenant and supervisor filtering happen in SQL before pagination.
 */
export async function loadTeamAttendancePreview(input: {
  organizationId: number;
  scope: MyTeamScope;
  cursor: number;
  now?: Date;
}): Promise<TeamAttendanceResponse> {
  const { organizationId, scope, cursor } = input;
  if (!Number.isSafeInteger(organizationId) || organizationId < 1 ||
    !Number.isSafeInteger(cursor) || cursor < 0 ||
    (scope.kind === "unit" && (!Number.isSafeInteger(scope.orgUnitId) || scope.orgUnitId < 1))) {
    throw new InvalidTeamAttendanceScopeError();
  }
  const now = input.now ?? new Date();
  const date = philippineBusinessDate(now);
  if (scope.kind === "unit") {
    const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits).where(and(
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.id, scope.orgUnitId),
      eq(orgUnits.active, true),
      or(isNull(orgUnits.effectiveFrom), lte(orgUnits.effectiveFrom, date)),
      or(isNull(orgUnits.effectiveUntil), gte(orgUnits.effectiveUntil, date)),
    )).limit(1);
    if (!unit) throw new InvalidTeamAttendanceScopeError();
  }

  const clauses = [
    eq(employees.organizationId, organizationId),
    gt(employees.id, cursor),
  ];
  if (scope.kind === "unit") clauses.push(eq(employees.orgUnitId, scope.orgUnitId));
  const candidates = await db.select({
    id: employees.id, firstName: employees.firstName, lastName: employees.lastName,
  }).from(employees).where(and(...clauses)).orderBy(asc(employees.id)).limit(PAGE_SIZE + 1);
  const page = candidates.slice(0, PAGE_SIZE);
  const employeeIds = page.map(row => row.id);

  const punches = employeeIds.length === 0 ? [] : await db.select({
    employeeId: timePunches.employeeId, timeIn: timePunches.timeIn, timeOut: timePunches.timeOut,
  }).from(timePunches).where(and(
    eq(timePunches.organizationId, organizationId),
    inArray(timePunches.employeeId, employeeIds),
    eq(timePunches.workDate, date),
  )).limit(PUNCH_CAP + 1);
  if (punches.length > PUNCH_CAP) throw new TeamAttendanceSourceOverflowError();

  const rows: TeamAttendanceDay[] = [];
  for (const employee of page) {
    // Existing source resolver always receives exact employer+employee+business date.
    // A broken schedule raises an error rather than inventing an open shift.
    const { schedule } = await loadResolvedEmployeeSchedule({
      organizationId, employeeId: employee.id, workDate: date,
    });
    rows.push(classifyTeamAttendance({
      employeeId: employee.id, name: (employee.firstName + " " + employee.lastName).trim(),
      workDate: date, schedule,
      punches: punches.filter(p => p.employeeId === employee.id),
    }));
  }

  const hasMore = candidates.length > PAGE_SIZE;
  return {
    organizationId, workDate: date, observedAt: now.toISOString(), scope,
    rows, summary: summarizeTeamAttendance(rows),
    page: {
      size: PAGE_SIZE, hasMore,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    },
    warning: "Advisory: current WFM schedules and stored punch records only. Missing punches do not prove absence. No certified shift coverage, site staffing demand, payroll hours or leave-duration conclusion. All counts are page-local.",
  };
}
