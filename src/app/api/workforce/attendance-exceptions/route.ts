import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceExceptionEvents,
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  employees,
  overtimeRequests,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  timePunches,
  userOrganizations,
  users,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { analyzeAttendanceDay } from "@/lib/workforce-attendance";
import {
  attendanceExceptionAgeHours,
  attendanceExceptionSlaStatus,
} from "@/lib/workforce-attendance-exception-governance";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  resolveDailySchedule,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import type {
  OvertimeRequestKind,
  OvertimeRequestStatus,
} from "@/lib/workforce-overtime";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (
    !ISO_DATE.test(startDate)
    || !ISO_DATE.test(endDate)
    || Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || end < start
  ) return [];

  const dates: string[] = [];
  for (
    let cursor = new Date(start);
    cursor <= end && dates.length <= 42;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const startDate = String(url.searchParams.get("startDate") ?? "").trim();
  const endDate = String(url.searchParams.get("endDate") ?? "").trim();
  const employeeIdRaw = String(url.searchParams.get("employeeId") ?? "").trim();
  const employeeId = employeeIdRaw ? Number(employeeIdRaw) : null;
  const includeAll = url.searchParams.get("includeAll") === "1";
  const dates = dateRange(startDate, endDate);

  if (
    !Number.isInteger(organizationId)
    || dates.length === 0
    || dates.length > 42
    || (employeeIdRaw && !Number.isInteger(employeeId))
  ) {
    return Response.json({
      error: "organizationId, startDate and endDate are required; range is limited to 42 days and employeeId is optional.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or Payroll roles can review attendance exceptions.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const employeeRows = await db.select().from(employees)
    .where(eq(employees.organizationId, organizationId))
    .orderBy(asc(employees.id));
  let visibleEmployees = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);

  if (employeeId != null) {
    const employee = employeeRows.find((row) => row.id === employeeId) ?? null;
    if (!employee) {
      return Response.json({ error: "Employee not found." }, { status: 404 });
    }
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) {
      return Response.json({ error: scope.error }, { status: scope.status });
    }
    visibleEmployees = [employee];
  }

  const employeeIds = visibleEmployees.map((employee) => employee.id);
  if (employeeIds.length === 0) {
    return Response.json({
      range: { startDate, endDate, days: dates.length },
      summary: { blockers: 0, warnings: 0, info: 0, employeesAffected: 0 },
      days: [],
    });
  }

  const [
    shifts,
    patterns,
    patternDays,
    patternSegments,
    assignments,
    overrides,
    worksiteAssignments,
    punches,
    overtimeRows,
    exceptionEventRows,
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
      .where(eq(schedulePatterns.organizationId, organizationId))
      .orderBy(asc(schedulePatternDays.patternId), asc(schedulePatternDays.dayIndex)),
    db.select({
      id: schedulePatternSegments.id,
      patternDayId: schedulePatternSegments.patternDayId,
      shiftDefinitionId: schedulePatternSegments.shiftDefinitionId,
      segmentOrder: schedulePatternSegments.segmentOrder,
    }).from(schedulePatternSegments)
      .innerJoin(schedulePatternDays, eq(schedulePatternSegments.patternDayId, schedulePatternDays.id))
      .innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId, organizationId))
      .orderBy(asc(schedulePatternSegments.patternDayId), asc(schedulePatternSegments.segmentOrder)),
    db.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, organizationId),
      inArray(employeeScheduleAssignments.employeeId, employeeIds),
    )).orderBy(
      asc(employeeScheduleAssignments.employeeId),
      asc(employeeScheduleAssignments.effectiveFrom),
      asc(employeeScheduleAssignments.id),
    ),
    db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, organizationId),
      inArray(scheduleOverrides.employeeId, employeeIds),
      gte(scheduleOverrides.workDate, startDate),
      lte(scheduleOverrides.workDate, endDate),
    )).orderBy(
      asc(scheduleOverrides.employeeId),
      asc(scheduleOverrides.workDate),
      asc(scheduleOverrides.id),
    ),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, organizationId),
      inArray(employeeWorksiteAssignments.employeeId, employeeIds),
    )).orderBy(
      asc(employeeWorksiteAssignments.employeeId),
      asc(employeeWorksiteAssignments.effectiveFrom),
      asc(employeeWorksiteAssignments.id),
    ),
    db.select().from(timePunches).where(and(
      eq(timePunches.organizationId, organizationId),
      inArray(timePunches.employeeId, employeeIds),
      gte(timePunches.workDate, startDate),
      lte(timePunches.workDate, endDate),
    )).orderBy(
      asc(timePunches.employeeId),
      asc(timePunches.workDate),
      asc(timePunches.id),
    ),
    db.select().from(overtimeRequests).where(and(
      eq(overtimeRequests.organizationId, organizationId),
      inArray(overtimeRequests.employeeId, employeeIds),
      gte(overtimeRequests.workDate, startDate),
      lte(overtimeRequests.workDate, endDate),
    )).orderBy(
      asc(overtimeRequests.employeeId),
      asc(overtimeRequests.workDate),
      asc(overtimeRequests.id),
    ),
    db.select().from(attendanceExceptionEvents).where(and(
      eq(attendanceExceptionEvents.organizationId, organizationId),
      inArray(attendanceExceptionEvents.employeeId, employeeIds),
      gte(attendanceExceptionEvents.workDate, startDate),
      lte(attendanceExceptionEvents.workDate, endDate),
    )).orderBy(
      asc(attendanceExceptionEvents.status),
      asc(attendanceExceptionEvents.slaDueAt),
      asc(attendanceExceptionEvents.firstDetectedAt),
      asc(attendanceExceptionEvents.id),
    ),
  ]);

  const assignmentsByEmployee = new Map<number, typeof assignments>();
  for (const row of assignments) {
    assignmentsByEmployee.set(
      row.employeeId,
      [...(assignmentsByEmployee.get(row.employeeId) ?? []), row],
    );
  }

  const overridesByEmployee = new Map<number, typeof overrides>();
  for (const row of overrides) {
    overridesByEmployee.set(
      row.employeeId,
      [...(overridesByEmployee.get(row.employeeId) ?? []), row],
    );
  }

  const worksiteAssignmentsByEmployee = new Map<number, typeof worksiteAssignments>();
  for (const row of worksiteAssignments) {
    worksiteAssignmentsByEmployee.set(
      row.employeeId,
      [...(worksiteAssignmentsByEmployee.get(row.employeeId) ?? []), row],
    );
  }

  const punchesByEmployeeDate = new Map<string, typeof punches>();
  for (const row of punches) {
    const key = `${row.employeeId}|${String(row.workDate)}`;
    punchesByEmployeeDate.set(key, [...(punchesByEmployeeDate.get(key) ?? []), row]);
  }

  const overtimeByEmployeeDate = new Map<string, typeof overtimeRows>();
  for (const row of overtimeRows) {
    const key = `${row.employeeId}|${String(row.workDate)}`;
    overtimeByEmployeeDate.set(key, [...(overtimeByEmployeeDate.get(key) ?? []), row]);
  }

  const rows = [];
  for (const employee of visibleEmployees) {
    const employeeAssignments = (assignmentsByEmployee.get(employee.id) ?? []).map((row) => ({
      id: row.id,
      patternId: row.patternId,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      anchorDate: String(row.anchorDate),
      workLocationOrgUnitId: row.workLocationOrgUnitId,
      worksiteId: row.worksiteId,
    }));
    const employeeOverrides = (overridesByEmployee.get(employee.id) ?? []).map((row) => ({
      id: row.id,
      workDate: String(row.workDate),
      kind: row.kind as "shift" | "split_shift" | "rest_day" | "off" | "location",
      isRestDay: row.isRestDay,
      segments: Array.isArray(row.segments)
        ? row.segments as WorkforceScheduleOverrideSegment[]
        : [],
      workLocationOrgUnitId: row.workLocationOrgUnitId,
      worksiteId: row.worksiteId,
      status: row.status as "pending" | "approved" | "rejected" | "cancelled",
      reason: row.reason,
    }));

    const employeeWorksites = (worksiteAssignmentsByEmployee.get(employee.id) ?? []).map((row) => ({
      id: row.id,
      worksiteId: row.worksiteId,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    }));

    for (const workDate of dates) {
      const schedule = resolveDailySchedule({
        date: workDate,
        assignments: employeeAssignments,
        patterns: patterns.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          cycleDays: row.cycleDays,
        })),
        patternDays: patternDays.map((row) => ({
          id: row.id,
          patternId: row.patternId,
          dayIndex: row.dayIndex,
          isRestDay: row.isRestDay,
          label: row.label,
        })),
        patternSegments: patternSegments.map((row) => ({
          patternDayId: row.patternDayId,
          shiftDefinitionId: row.shiftDefinitionId,
          segmentOrder: row.segmentOrder,
        })),
        shifts: shifts.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          startTime: row.startTime,
          endTime: row.endTime,
          breakMinutes: row.breakMinutes,
          spansMidnight: row.spansMidnight,
        })),
        overrides: employeeOverrides,
        defaultWorksiteId:
          selectEffectiveWorksiteAssignment(employeeWorksites, workDate)?.worksiteId ?? null,
      });
      const key = `${employee.id}|${workDate}`;
      const dayPunches = punchesByEmployeeDate.get(key) ?? [];
      const dayOvertime = overtimeByEmployeeDate.get(key) ?? [];
      const analysis = analyzeAttendanceDay({
        date: workDate,
        schedule,
        punches: dayPunches.map((punch) => ({
          id: punch.id,
          timeIn: punch.timeIn,
          timeOut: punch.timeOut,
          breakStart: punch.breakStart,
          breakEnd: punch.breakEnd,
          shiftStart: punch.shiftStart,
          shiftEnd: punch.shiftEnd,
        })),
        overtimeRequests: dayOvertime.map((ot) => ({
          id: ot.id,
          status: ot.status as OvertimeRequestStatus,
          requestKind: ot.requestKind as OvertimeRequestKind,
          requestedMinutes: ot.requestedMinutes,
          requestedByUserId: ot.requestedByUserId,
          decidedByUserId: ot.decidedByUserId,
        })),
      });

      if (includeAll || analysis.exceptions.length > 0) {
        rows.push({
          employee: {
            id: employee.id,
            employeeNo: employee.employeeNo,
            name: `${employee.firstName} ${employee.lastName}`,
            orgUnitId: employee.orgUnitId,
          },
          analysis,
        });
      }
    }
  }

  const exceptions = rows.flatMap((row) => row.analysis.exceptions);
  const affected = new Set(
    rows
      .filter((row) => row.analysis.exceptions.some((item) => item.severity !== "info"))
      .map((row) => row.employee.id),
  );

  const now = new Date();
  const eventLedger = exceptionEventRows.map((event) => ({
    ...event,
    ageHours: attendanceExceptionAgeHours(event.firstDetectedAt, now),
    slaStatus: attendanceExceptionSlaStatus({
      status: event.status,
      slaDueAt: event.slaDueAt,
      now,
    }),
  }));
  const openEvents = eventLedger.filter((event) => event.status === "open");

  return Response.json({
    range: { startDate, endDate, days: dates.length },
    summary: {
      blockers: exceptions.filter((row) => row.severity === "blocker").length,
      warnings: exceptions.filter((row) => row.severity === "warning").length,
      info: exceptions.filter((row) => row.severity === "info").length,
      employeesAffected: affected.size,
      openPersistedExceptions: openEvents.length,
      overduePersistedExceptions: openEvents.filter((event) => event.slaStatus === "overdue").length,
      unassignedPersistedExceptions: openEvents.filter((event) => event.ownerUserId == null).length,
    },
    days: rows,
    eventLedger,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const eventId = Number(body.eventId);
  const action = String(body.action ?? "").trim();
  if (!Number.isInteger(organizationId) || !Number.isInteger(eventId)) {
    return Response.json({ error: "organizationId and eventId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or Payroll roles can manage attendance exception operations.",
  );
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `workforce-attendance-exception-${action || "mutation"}`,
    resourceId: eventId,
    limit: 60,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [event] = await db.select().from(attendanceExceptionEvents).where(and(
    eq(attendanceExceptionEvents.id, eventId),
    eq(attendanceExceptionEvents.organizationId, organizationId),
  )).limit(1);
  if (!event) return Response.json({ error: "Attendance exception event not found." }, { status: 404 });

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, event.employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  if (action === "assign") {
    if (event.status !== "open") {
      return Response.json({ error: "Only open attendance exceptions can be assigned." }, { status: 409 });
    }
    const ownerUserId = Number(body.ownerUserId);
    if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
      return Response.json({ error: "ownerUserId is required." }, { status: 400 });
    }
    const [owner] = await db.select({
      id: users.id,
      name: users.name,
      active: users.active,
      orgUnitId: userOrganizations.orgUnitId,
    }).from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.userId, ownerUserId),
        eq(userOrganizations.active, true),
        eq(users.active, true),
      )).limit(1);
    if (!owner) {
      return Response.json({ error: "The selected owner is not an active user in this organization." }, { status: 422 });
    }
    if (!access.companyWide && owner.orgUnitId != null && owner.orgUnitId !== access.orgUnitId) {
      return Response.json({ error: "Scoped operators cannot assign exceptions outside their organization unit." }, { status: 403 });
    }

    const [updated] = await db.update(attendanceExceptionEvents).set({
      ownerUserId: owner.id,
      ownerName: owner.name,
      updatedAt: new Date(),
    }).where(eq(attendanceExceptionEvents.id, event.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Attendance exception assigned",
      resource: `Attendance exception #${event.id}`,
      metadata: {
        attendanceExceptionEventId: event.id,
        employeeId: event.employeeId,
        workDate: event.workDate,
        ownerUserId: owner.id,
        ownerName: owner.name,
        slaDueAt: event.slaDueAt,
      },
    });

    return Response.json({ event: updated });
  }

  if (action === "record_resolution") {
    const resolutionNote = String(body.resolutionNote ?? "").trim().slice(0, 1000);
    if (event.status !== "resolved") {
      return Response.json({
        error: "Resolution evidence can only be recorded after the authoritative attendance exception is resolved.",
      }, { status: 409 });
    }
    if (resolutionNote.length < 3) {
      return Response.json({ error: "resolutionNote is required." }, { status: 400 });
    }

    const recordedAt = new Date();
    const [updated] = await db.update(attendanceExceptionEvents).set({
      resolutionNote,
      resolvedByUserId: user.id,
      resolvedByName: user.name,
      resolutionRecordedAt: recordedAt,
      updatedAt: recordedAt,
    }).where(eq(attendanceExceptionEvents.id, event.id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Attendance exception resolution evidence recorded",
      resource: `Attendance exception #${event.id}`,
      metadata: {
        attendanceExceptionEventId: event.id,
        employeeId: event.employeeId,
        workDate: event.workDate,
        resolvedAt: event.resolvedAt,
        resolutionRecordedAt: recordedAt,
      },
    });

    return Response.json({ event: updated });
  }

  return Response.json({
    error: "Unsupported action. Use assign or record_resolution.",
  }, { status: 400 });
}
