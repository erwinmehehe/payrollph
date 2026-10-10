import {
  and, asc, count, eq, gt, ilike, inArray, isNull, lte, gte, or,
} from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveRequests, orgUnits, overtimeRequests } from "@/db/schema";
import {
  summarizeMyTeamPage,
  type MyTeamResponse,
  type MyTeamScope,
  type MyTeamStatusFilter,
} from "@/lib/hcm-my-team-contract";

const PAGE_SIZE = 25;

export class InvalidMyTeamScopeError extends Error {
  constructor() { super("Assigned supervisory unit is not active in the selected employer."); }
}

function philippineDate(now: Date) {
  const fields = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => fields.find((field) => field.type === type)?.value ?? "";
  return [part("year"), part("month"), part("day")].join("-");
}

function escapedSearch(query: string) {
  return "%" + query.replace(/[%_\\]/g, "\\$&") + "%";
}

/**
 * This loader expects a scope authorized by the API/page.
 * All reads are bounded and explicitly tenant-filtered; no compensation,
 * leave reasons, documents, payment or employee identity numbers are queried.
 */
export async function loadHcmMyTeam(input: {
  organizationId: number;
  scope: MyTeamScope;
  cursor: number;
  query: string;
  statusFilter: MyTeamStatusFilter;
}): Promise<MyTeamResponse> {
  const { organizationId, scope, cursor, query, statusFilter } = input;
  if (!Number.isSafeInteger(organizationId) || organizationId < 1 ||
      !Number.isSafeInteger(cursor) || cursor < 0 || query.length > 70 ||
      (scope.kind === "unit" &&
        (!Number.isSafeInteger(scope.orgUnitId) || scope.orgUnitId < 1))) {
    throw new InvalidMyTeamScopeError();
  }
  const observedAt = new Date();
  const today = philippineDate(observedAt);

  if (scope.kind === "unit") {
    const [verified] = await db.select({ id: orgUnits.id }).from(orgUnits)
      .where(and(
        eq(orgUnits.organizationId, organizationId),
        eq(orgUnits.id, scope.orgUnitId),
        eq(orgUnits.active, true),
        or(isNull(orgUnits.effectiveFrom), lte(orgUnits.effectiveFrom, today)),
        or(isNull(orgUnits.effectiveUntil), gte(orgUnits.effectiveUntil, today)),
      )).limit(1);
    if (!verified) throw new InvalidMyTeamScopeError();
  }

  const constraints = [
    eq(employees.organizationId, organizationId),
    gt(employees.id, cursor),
  ];
  if (scope.kind === "unit") constraints.push(eq(employees.orgUnitId, scope.orgUnitId));
  if (statusFilter !== "all") constraints.push(eq(employees.status, statusFilter));
  if (query) {
    const pattern = escapedSearch(query);
    constraints.push(or(
      ilike(employees.employeeNo, pattern),
      ilike(employees.firstName, pattern),
      ilike(employees.lastName, pattern),
      ilike(employees.title, pattern),
    )!);
  }

  const sourceRows = await db.select({
    id: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    title: employees.title,
    employmentType: employees.employmentType,
    status: employees.status,
    sourceUnitId: employees.orgUnitId,
    verifiedUnitName: orgUnits.name,
  }).from(employees)
    .leftJoin(orgUnits, and(
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.id, employees.orgUnitId),
      eq(orgUnits.active, true),
      or(isNull(orgUnits.effectiveFrom), lte(orgUnits.effectiveFrom, today)),
      or(isNull(orgUnits.effectiveUntil), gte(orgUnits.effectiveUntil, today)),
    ))
    .where(and(...constraints))
    .orderBy(asc(employees.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = sourceRows.length > PAGE_SIZE;
  const page = sourceRows.slice(0, PAGE_SIZE);
  const employeeIds = page.map((row) => row.id);
  const [leaveCounts, overtimeCounts] = employeeIds.length === 0
    ? [[], []]
    : await Promise.all([
      db.select({
        employeeId: leaveRequests.employeeId, pending: count(),
      }).from(leaveRequests)
        .where(and(
          eq(leaveRequests.organizationId, organizationId),
          inArray(leaveRequests.employeeId, employeeIds),
          eq(leaveRequests.status, "Pending"),
        )).groupBy(leaveRequests.employeeId),
      db.select({
        employeeId: overtimeRequests.employeeId, pending: count(),
      }).from(overtimeRequests)
        .where(and(
          eq(overtimeRequests.organizationId, organizationId),
          inArray(overtimeRequests.employeeId, employeeIds),
          eq(overtimeRequests.status, "pending"),
        )).groupBy(overtimeRequests.employeeId),
    ]);

  const leaveById = new Map(leaveCounts.map((row) => [row.employeeId, row.pending]));
  const overtimeById = new Map(overtimeCounts.map((row) => [row.employeeId, row.pending]));

  const items = page.map((row) => ({
    id: row.id,
    employeeNo: row.employeeNo,
    name: [row.firstName, row.lastName].filter(Boolean).join(" "),
    jobTitle: row.title,
    employmentType: row.employmentType,
    status: row.status,
    orgUnitName: row.verifiedUnitName,
    orgUnitIntegrity: (
      row.sourceUnitId === null ? "not_recorded" :
        row.verifiedUnitName === null ? "unverified" : "verified"
    ) as "not_recorded" | "unverified" | "verified",
    pendingLeaveRecords: leaveById.get(row.id) ?? 0,
    pendingOvertimeRecords: overtimeById.get(row.id) ?? 0,
  }));

  return {
    organizationId,
    observedAt: observedAt.toISOString(),
    scope,
    query,
    statusFilter,
    items,
    page: {
      size: PAGE_SIZE,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    },
    summary: summarizeMyTeamPage(items),
    warning: "Current employee records in the authorized unit or employer only. Pending leave/overtime are recorded source counts, not decisions assigned to you. No staffing, pay, approval or completeness certification.",
  };
}
