import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveRequests, timePunches } from "@/db/schema";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import { approvedLeaveCoverageImpact } from "@/lib/workforce-absence";
import { classifyFloorSegment, floorSegmentBounds, summarizeFloor, type FloorRow } from "@/lib/workforce-live-floor";

export const dynamic = "force-dynamic";

function phDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
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

  const allEmployees = await db.select({
    id: employees.id, employeeNo: employees.employeeNo, firstName: employees.firstName,
    lastName: employees.lastName, status: employees.status, orgUnitId: employees.orgUnitId,
  }).from(employees).where(eq(employees.organizationId, organizationId)).orderBy(asc(employees.id));
  const visible = allEmployees.filter(row =>
    access.companyWide || row.orgUnitId === access.orgUnitId);
  const slice = visible.slice((page - 1) * pageSize, page * pageSize);
  const generatedAt = new Date();
  const workDate = phDay(generatedAt);
  const previousDate = addDay(workDate, -1);
  const ids = slice.map(row => row.id);
  if (ids.length === 0) {
    return Response.json({
      generatedAt: generatedAt.toISOString(), timezone: "Asia/Manila", workDate,
      page, pageSize, totalEmployees: visible.length, hasMore: false,
      rows: [], summary: summarizeFloor([]), advisory: true,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const [punches, leaves] = await Promise.all([
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
      lte(leaveRequests.startDate, workDate), gte(leaveRequests.endDate, previousDate),
    )),
  ]);

  const punchesByKey = new Map<string, typeof punches>();
  for (const punch of punches) {
    const key = punch.employeeId + "|" + String(punch.workDate);
    const values = punchesByKey.get(key) ?? [];
    values.push(punch);
    punchesByKey.set(key, values);
  }
  const leaveByKey = new Map<string, "full" | "partial_or_uncertain">();
  for (const leave of leaves) {
    if (leave.status.toLowerCase() !== "approved") continue;
    const kind = approvedLeaveCoverageImpact({
      id: leave.id, employeeId: leave.employeeId, startDate: String(leave.startDate),
      endDate: String(leave.endDate), days: Number(leave.days),
    }).kind === "full_day" ? "full" : "partial_or_uncertain";
    for (const date of [previousDate, workDate]) {
      if (date < String(leave.startDate) || date > String(leave.endDate)) continue;
      const key = leave.employeeId + "|" + date;
      if (kind === "full" || !leaveByKey.has(key)) leaveByKey.set(key, kind);
    }
  }
  const rows: FloorRow[] = [];
  let unresolvedSchedules = 0;
  // The currently visible page only. Overnight yesterday + today's shifts
  // are evaluated against the same authoritative schedule resolver as WFM.
  for (const employee of slice) {
    try {
      const days = await resolveEmployeeScheduleWindow({
        organizationId, employeeId: employee.id, startDate: previousDate, endDate: workDate,
      });
      for (const day of days) {
        for (const segment of day.segments) {
          const bounds = floorSegmentBounds(day.date, segment);
          // Show the live operating window: yesterday's overnight segments
          // and today's past/upcoming segments. Do not show all of yesterday.
          if (day.date === previousDate && bounds.end <= Date.parse(workDate + "T00:00:00+08:00")) continue;
          const row = classifyFloorSegment({
            now: generatedAt, employee: {
              id: employee.id, employeeNo: employee.employeeNo,
              name: employee.firstName + " " + employee.lastName, status: employee.status,
            }, workDate: day.date, worksiteId: day.worksiteId, segment,
            punches: punchesByKey.get(employee.id + "|" + day.date) ?? [],
            leave: leaveByKey.get(employee.id + "|" + day.date) ?? "none",
          });
          rows.push(row);
        }
      }
    } catch {
      // Never convert an unreadable authoritative schedule into "no shift".
      unresolvedSchedules++;
    }
  }
  rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.employeeId - b.employeeId);
  return Response.json({
    generatedAt: generatedAt.toISOString(), timezone: "Asia/Manila", workDate, page, pageSize,
    totalEmployees: visible.length, hasMore: page * pageSize < visible.length,
    unresolvedSchedules, rows, summary: summarizeFloor(rows), advisory: true,
    scope: access.companyWide ? "company" : "organization_unit",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
