import { and, asc, count, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  employees,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  worksites,
} from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  resolveDailySchedule,
  type WorkforceScheduleOverride,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import {
  rosterWeekDates,
  summarizeTeamRoster,
  type TeamRosterRow,
} from "@/lib/workforce-team-roster";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

/**
 * Read-only, paginated seven-day roster for People admins.
 * All employee, schedule and worksite reads are tenant-scoped. A scoped People
 * admin never sees another organization unit's employee records.
 * Mutations continue through the existing MFA-gated schedules POST endpoint.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "A valid organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can review the team roster.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access || (!access.companyWide && access.orgUnitId == null)) {
    return Response.json({ error: "An active People scope is required." }, { status: 403 });
  }

  const startDate = String(url.searchParams.get("startDate") ?? "");
  let weekDates: string[];
  try {
    weekDates = rosterWeekDates(startDate);
  } catch {
    return Response.json({ error: "A valid seven-day window start (YYYY-MM-DD) is required." }, { status: 400 });
  }
  const endDate = weekDates[6];
  const page = Number(url.searchParams.get("page") ?? "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
    return Response.json({ error: "Page must be an integer from 1 to 10000." }, { status: 400 });
  }
  const search = String(url.searchParams.get("search") ?? "").trim().slice(0, 70);

  const criteria = [eq(employees.organizationId, organizationId)];
  if (!access.companyWide) criteria.push(eq(employees.orgUnitId, access.orgUnitId!));
  if (search) {
    const needle = "%" + search.replace(/[%_\\]/g, "\\$&") + "%";
    criteria.push(or(
      ilike(employees.firstName, needle),
      ilike(employees.lastName, needle),
      ilike(employees.employeeNo, needle),
    )!);
  }
  const scope = and(...criteria);

  const [totals, employeeRows] = await Promise.all([
    db.select({ total: count() }).from(employees).where(scope),
    db.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      status: employees.status,
      orgUnitId: employees.orgUnitId,
    }).from(employees)
      .where(scope)
      .orderBy(asc(employees.employeeNo), asc(employees.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);

  const totalEmployees = totals[0]?.total ?? 0;
  const employeeIds = employeeRows.map((row) => row.id);
  const emptyPage = {
    startDate,
    endDate,
    weekDates,
    page,
    pageSize: PAGE_SIZE,
    totalEmployees,
    totalPages: Math.max(1, Math.ceil(totalEmployees / PAGE_SIZE)),
    search,
    rows: [] as TeamRosterRow[],
    summary: summarizeTeamRoster([]),
    shifts: [],
    worksites: [],
  };
  if (employeeIds.length === 0) {
    return Response.json(emptyPage, { headers: { "Cache-Control": "no-store" } });
  }

  const [
    shifts,
    patterns,
    patternDays,
    patternSegments,
    assignmentRows,
    overrideRows,
    worksiteAssignments,
    worksiteRows,
  ] = await Promise.all([
    db.select().from(shiftDefinitions)
      .where(eq(shiftDefinitions.organizationId, organizationId))
      .orderBy(asc(shiftDefinitions.code)),
    db.select().from(schedulePatterns)
      .where(eq(schedulePatterns.organizationId, organizationId))
      .orderBy(asc(schedulePatterns.code)),
    db.select({
      id: schedulePatternDays.id,
      patternId: schedulePatternDays.patternId,
      dayIndex: schedulePatternDays.dayIndex,
      isRestDay: schedulePatternDays.isRestDay,
      label: schedulePatternDays.label,
    }).from(schedulePatternDays)
      .innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
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
      inArray(employeeScheduleAssignments.employeeId, employeeIds),
      lte(employeeScheduleAssignments.effectiveFrom, endDate),
    )),
    db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, organizationId),
      inArray(scheduleOverrides.employeeId, employeeIds),
      gte(scheduleOverrides.workDate, startDate),
      lte(scheduleOverrides.workDate, endDate),
    )),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, organizationId),
      inArray(employeeWorksiteAssignments.employeeId, employeeIds),
      lte(employeeWorksiteAssignments.effectiveFrom, endDate),
    )),
    db.select({
      id: worksites.id,
      code: worksites.code,
      name: worksites.name,
      orgUnitId: worksites.orgUnitId,
      active: worksites.active,
    }).from(worksites).where(eq(worksites.organizationId, organizationId)),
  ]);

  const rows: TeamRosterRow[] = employeeRows.map((employee) => {
    const employeeAssignments = assignmentRows
      .filter((row) => row.employeeId === employee.id)
      .map((row) => ({
        id: row.id,
        patternId: row.patternId,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        anchorDate: String(row.anchorDate),
        workLocationOrgUnitId: row.workLocationOrgUnitId,
        worksiteId: row.worksiteId,
      }));
    const employeeOverrides: WorkforceScheduleOverride[] = overrideRows
      .filter((row) => row.employeeId === employee.id)
      .map((row) => ({
        id: row.id,
        workDate: String(row.workDate),
        kind: row.kind as WorkforceScheduleOverride["kind"],
        isRestDay: row.isRestDay,
        segments: Array.isArray(row.segments)
          ? row.segments as WorkforceScheduleOverrideSegment[]
          : [],
        workLocationOrgUnitId: row.workLocationOrgUnitId,
        worksiteId: row.worksiteId,
        status: row.status as WorkforceScheduleOverride["status"],
        reason: row.reason,
      }));
    const employeeWorksites = worksiteAssignments
      .filter((row) => row.employeeId === employee.id)
      .map((row) => ({
        id: row.id,
        worksiteId: row.worksiteId,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      }));

    let error: string | null = null;
    let days: TeamRosterRow["days"] = [];
    try {
      days = weekDates.map((date) => {
        const day = resolveDailySchedule({
          date,
          assignments: employeeAssignments,
          patterns,
          patternDays,
          patternSegments,
          shifts,
          overrides: employeeOverrides,
          defaultWorksiteId:
            selectEffectiveWorksiteAssignment(employeeWorksites, date)?.worksiteId ?? null,
        });
        return {
          date: day.date,
          source: day.source,
          isRestDay: day.isRestDay,
          worksiteId: day.worksiteId,
          segments: day.segments.map((segment) => ({
            shiftDefinitionId: segment.shiftDefinitionId,
            shiftCode: segment.shiftCode,
            startTime: segment.startTime,
            endTime: segment.endTime,
            breakMinutes: segment.breakMinutes,
            spansMidnight: segment.spansMidnight,
          })),
        };
      });
    } catch {
      // Missing/ambiguous scheduling evidence must never be presented as a rest
      // day or a valid assignment. Keep this employee visibly unresolved.
      days = [];
      error = "Schedule evidence needs review before this roster can be used.";
    }

    return {
      employee: {
        id: employee.id,
        employeeNo: employee.employeeNo,
        name: (employee.firstName + " " + employee.lastName).trim(),
        status: employee.status,
        orgUnitId: employee.orgUnitId,
      },
      days,
      error,
    };
  });

  return Response.json({
    ...emptyPage,
    rows,
    summary: summarizeTeamRoster(rows),
    shifts: shifts.filter((shift) => shift.active).map((shift) => ({
      id: shift.id,
      code: shift.code,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      spansMidnight: shift.spansMidnight,
    })),
    worksites: worksiteRows.filter((site) =>
      access.companyWide || site.orgUnitId == null || site.orgUnitId === access.orgUnitId
    ),
  }, { headers: { "Cache-Control": "no-store" } });
}
