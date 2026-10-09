import { and, asc, count, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  employees, leaveRequests, leaveRequestIntervalSets, leaveRequestIntervals, separationRecords,
  employeeScheduleAssignments, employeeWorksiteAssignments, scheduleOverrides,
  schedulePatterns, schedulePatternDays, schedulePatternSegments, shiftDefinitions, timePunches,
} from "@/db/schema";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { resolveDailySchedule, type WorkforceScheduleOverrideSegment } from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import { approvedLeaveCoverageImpact } from "@/lib/workforce-absence";
import { classifyFloorSegment, floorSegmentBounds, summarizeFloor, type FloorRow } from "@/lib/workforce-live-floor";

export const dynamic = "force-dynamic";

function phDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => parts.find(item => item.type === key)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}
function addDay(value: string, offset: number) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * Live floor is only a read-only snapshot. Paged worker population prevents
 * accidental unbounded queries; no untrusted org/employee scope is accepted.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = 25;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(page) || page < 1 || page > 10000) {
    return Response.json({ error: "Valid organizationId and page are required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(user.id, organizationId, WORKFORCE_MANAGER_ROLES,
    "Only workforce managers may view the live floor.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Forbidden" }, { status: 403 });

  // Scope and paginate in SQL. No full workforce roster can leak into memory
  // or be sent to a manager scoped to one organizational unit.
  const scope = access.companyWide
    ? eq(employees.organizationId, organizationId)
    : and(eq(employees.organizationId, organizationId), eq(employees.orgUnitId, access.orgUnitId!));
  const [counts, slice] = await Promise.all([
    db.select({ total: count() }).from(employees).where(scope),
    db.select({
      id: employees.id, employeeNo: employees.employeeNo,
      firstName: employees.firstName, lastName: employees.lastName,
      status: employees.status, startDate: employees.startDate,
    }).from(employees).where(scope).orderBy(asc(employees.id))
      .limit(pageSize).offset((page - 1) * pageSize),
  ]);
  const totalEmployees = Number(counts[0]?.total ?? 0);
  const generatedAt = new Date();
  const workDate = phDay(generatedAt);
  const previousDate = addDay(workDate, -1);
  const ids = slice.map(row => row.id);
  if (ids.length === 0) {
    return Response.json({
      generatedAt: generatedAt.toISOString(), timezone: "Asia/Manila", workDate,
      page, pageSize, totalEmployees, hasMore: false,
      rows: [], summary: summarizeFloor([]), advisory: true,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const [punches, leaves, exits, shifts, patterns, patternDays, patternSegments,
    assignments, overrides, worksiteAssignments] = await Promise.all([
    db.select({
      id: timePunches.id, employeeId: timePunches.employeeId, workDate: timePunches.workDate,
      timeIn: timePunches.timeIn, timeOut: timePunches.timeOut,
      breakStart: timePunches.breakStart, breakEnd: timePunches.breakEnd,
    }).from(timePunches).where(and(
      eq(timePunches.organizationId, organizationId), inArray(timePunches.employeeId, ids),
      gte(timePunches.workDate, previousDate), lte(timePunches.workDate, workDate),
    )),
    db.select({
      id: leaveRequests.id, employeeId: leaveRequests.employeeId,
      startDate: leaveRequests.startDate, endDate: leaveRequests.endDate,
      status: leaveRequests.status, days: leaveRequests.days,
    }).from(leaveRequests).where(and(
      eq(leaveRequests.organizationId, organizationId), inArray(leaveRequests.employeeId, ids),
      eq(leaveRequests.status, "Approved"),
      lte(leaveRequests.startDate, workDate), gte(leaveRequests.endDate, previousDate),
    )),
    db.select({
      employeeId: separationRecords.employeeId, status: separationRecords.status,
      lastDay: separationRecords.lastDay,
    }).from(separationRecords).where(and(
      eq(separationRecords.organizationId, organizationId), inArray(separationRecords.employeeId, ids),
    )),
    db.select().from(shiftDefinitions).where(eq(shiftDefinitions.organizationId, organizationId)),
    db.select().from(schedulePatterns).where(eq(schedulePatterns.organizationId, organizationId)),
    db.select({
      id: schedulePatternDays.id, patternId: schedulePatternDays.patternId,
      dayIndex: schedulePatternDays.dayIndex, isRestDay: schedulePatternDays.isRestDay,
      label: schedulePatternDays.label,
    }).from(schedulePatternDays).innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId, organizationId)),
    db.select({
      patternDayId: schedulePatternSegments.patternDayId,
      shiftDefinitionId: schedulePatternSegments.shiftDefinitionId,
      segmentOrder: schedulePatternSegments.segmentOrder,
    }).from(schedulePatternSegments)
      .innerJoin(schedulePatternDays, eq(schedulePatternSegments.patternDayId, schedulePatternDays.id))
      .innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId, organizationId)),
    db.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, organizationId),
      inArray(employeeScheduleAssignments.employeeId, ids),
      lte(employeeScheduleAssignments.effectiveFrom, workDate),
      or(isNull(employeeScheduleAssignments.effectiveUntil),
        gte(employeeScheduleAssignments.effectiveUntil, previousDate)),
    )),
    db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, organizationId),
      inArray(scheduleOverrides.employeeId, ids),
      gte(scheduleOverrides.workDate, previousDate), lte(scheduleOverrides.workDate, workDate),
    )),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, organizationId),
      inArray(employeeWorksiteAssignments.employeeId, ids),
      lte(employeeWorksiteAssignments.effectiveFrom, workDate),
      or(isNull(employeeWorksiteAssignments.effectiveUntil),
        gte(employeeWorksiteAssignments.effectiveUntil, previousDate)),
    )),
  ]);


  const punchesByKey = new Map<string, typeof punches>();
  for (const punch of punches) {
    const key = punch.employeeId + "|" + String(punch.workDate);
    const values = punchesByKey.get(key) ?? [];
    values.push(punch);
    punchesByKey.set(key, values);
  }
  const leaveIds = leaves.map(row => row.id);
  const sets = leaveIds.length ? await db.select({
    id: leaveRequestIntervalSets.id, leaveRequestId: leaveRequestIntervalSets.leaveRequestId,
  }).from(leaveRequestIntervalSets).where(and(
    eq(leaveRequestIntervalSets.organizationId, organizationId),
    inArray(leaveRequestIntervalSets.leaveRequestId, leaveIds),
    eq(leaveRequestIntervalSets.status, "current"),
  )) : [];
  const setIds = sets.map(row => row.id);
  const intervals = setIds.length ? await db.select({
    intervalSetId: leaveRequestIntervals.intervalSetId,
    workDate: leaveRequestIntervals.workDate, kind: leaveRequestIntervals.kind,
  }).from(leaveRequestIntervals).where(and(
    eq(leaveRequestIntervals.organizationId, organizationId),
    inArray(leaveRequestIntervals.intervalSetId, setIds),
    gte(leaveRequestIntervals.workDate, previousDate), lte(leaveRequestIntervals.workDate, workDate),
  )) : [];
  const setByLeaveId = new Map(sets.map(row => [row.leaveRequestId, row.id]));
  const leaveByKey = new Map<string, "full" | "partial_or_uncertain">();
  for (const leave of leaves) {
    for (const date of [previousDate, workDate]) {
      if (date < String(leave.startDate) || date > String(leave.endDate)) continue;
      const intervalSetId = setByLeaveId.get(leave.id);
      const matches = intervalSetId === undefined ? [] : intervals.filter(row =>
        row.intervalSetId === intervalSetId && String(row.workDate) === date);
      // Once precise evidence exists, never override it using the legacy
      // numeric day total. Missing/partial intervals remain manager review.
      const kind = intervalSetId !== undefined
        ? matches.length === 1 && matches[0].kind === "full_day" ? "full" : "partial_or_uncertain"
        : approvedLeaveCoverageImpact({
          id: leave.id, employeeId: leave.employeeId, startDate: String(leave.startDate),
          endDate: String(leave.endDate), days: Number(leave.days),
        }).kind === "full_day" ? "full" : "partial_or_uncertain";
      const key = leave.employeeId + "|" + date;
      if (leaveByKey.has(key)) {
        // Multiple separately approved leave sources on the same day require
        // review rather than silently treating either as authoritative.
        leaveByKey.set(key, "partial_or_uncertain");
      } else {
        leaveByKey.set(key, kind);
      }
    }
  }
  const rows: FloorRow[] = [];
  let unresolvedSchedules = 0;
  // Resolve the bounded employee page from batched source tables. This avoids
  // repeatedly querying 7+ schedule tables per employee on every refresh.
  const resolver = {
    shifts: shifts.map(row => ({
      id: row.id, code: row.code, name: row.name, startTime: row.startTime,
      endTime: row.endTime, breakMinutes: row.breakMinutes, spansMidnight: row.spansMidnight,
    })),
    patterns: patterns.map(row => ({
      id: row.id, code: row.code, name: row.name, cycleDays: row.cycleDays,
    })),
    patternDays, patternSegments,
  };
  for (const employee of slice) {
    try {
      const workerAssignments = assignments.filter(row => row.employeeId === employee.id).map(row => ({
        id: row.id, patternId: row.patternId,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        anchorDate: String(row.anchorDate),
        workLocationOrgUnitId: row.workLocationOrgUnitId, worksiteId: row.worksiteId,
      }));
      const workerOverrides = overrides.filter(row => row.employeeId === employee.id).map(row => ({
        id: row.id, workDate: String(row.workDate),
        kind: row.kind as "shift" | "split_shift" | "rest_day" | "off" | "location",
        isRestDay: row.isRestDay,
        segments: Array.isArray(row.segments) ? row.segments as WorkforceScheduleOverrideSegment[] : [],
        workLocationOrgUnitId: row.workLocationOrgUnitId, worksiteId: row.worksiteId,
        status: row.status as "pending" | "approved" | "rejected" | "cancelled", reason: row.reason,
      }));
      const defaultWorksites = worksiteAssignments.filter(row => row.employeeId === employee.id).map(row => ({
        id: row.id, worksiteId: row.worksiteId, effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      }));
      const conflictingExit = exits.some(row =>
        row.employeeId === employee.id &&
        ["draft", "approved", "released"].includes(row.status) &&
        String(row.lastDay) >= String(employee.startDate));
      for (const date of [previousDate, workDate]) {
        const day = resolveDailySchedule({
          ...resolver, date, assignments: workerAssignments, overrides: workerOverrides,
          defaultWorksiteId: selectEffectiveWorksiteAssignment(defaultWorksites, date)?.worksiteId ?? null,
        });
        for (const segment of day.segments) {
          const bounds = floorSegmentBounds(date, segment);
          if (date === previousDate && bounds.end <= Date.parse(workDate + "T00:00:00+08:00")) continue;
          rows.push(classifyFloorSegment({
            now: generatedAt, employee: {
              id: employee.id, employeeNo: employee.employeeNo,
              name: employee.firstName + " " + employee.lastName,
              status: conflictingExit || String(employee.startDate) > date ? "Employment review" : employee.status,
            }, workDate: date, worksiteId: day.worksiteId, segment,
            punches: punchesByKey.get(employee.id + "|" + date) ?? [],
            leave: leaveByKey.get(employee.id + "|" + date) ?? "none",
          }));
        }
      }
    } catch {
      unresolvedSchedules++;
    }
  }
  rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.employeeId - b.employeeId);
  return Response.json({
    generatedAt: generatedAt.toISOString(), timezone: "Asia/Manila", workDate, page, pageSize,
    totalEmployees, hasMore: page * pageSize < totalEmployees,
    unresolvedSchedules, rows, summary: summarizeFloor(rows), advisory: true,
    scope: access.companyWide ? "company" : "organization_unit",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
