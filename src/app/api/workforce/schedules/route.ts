import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  employees,
  orgUnits,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  workforceScheduleGuardrailPolicies,
  worksites,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  resolveDailySchedule,
  validateSchedulePattern,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import {
  DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
  evaluateScheduleGuardrails,
  scheduleGuardrailBlocksMutation,
  type ScheduleGuardrailPolicy,
} from "@/lib/workforce-schedule-guardrails";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import {
  markTimesheetsStaleForEmployeeDate,
  markTimesheetsStaleForEmployeeRange,
} from "@/lib/workforce-timesheet-server";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import { employeeSiteEligibility } from "@/lib/hcm-worksite-eligibility-server";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const OVERRIDE_KINDS = new Set(["shift", "split_shift", "rest_day", "off", "location"]);

function cleanCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

function validDate(value: unknown) {
  return ISO_DATE.test(String(value ?? ""));
}

function inclusiveDates(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end && dates.length <= 42; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function scheduleGuardrailPolicy(organizationId: number, executor: Pick<typeof db, "select"> = db): Promise<ScheduleGuardrailPolicy> {
  const [row] = await executor.select().from(workforceScheduleGuardrailPolicies)
    .where(eq(workforceScheduleGuardrailPolicies.organizationId, organizationId))
    .limit(1);
  if (!row) return DEFAULT_SCHEDULE_GUARDRAIL_POLICY;
  return {
    minimumRestMinutes: row.minimumRestMinutes,
    maxConsecutiveWorkingDays: row.maxConsecutiveWorkingDays,
    rollingSevenDayMinutes: row.rollingSevenDayMinutes,
    enforcementMode: row.enforcementMode === "block" ? "block" : "advisory",
    active: row.active,
  };
}

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) {
    return { employee: null, denied: Response.json({ error: "Employee not found." }, { status: 404 }) };
  }

  const access = await getAccess(userId, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) {
    return {
      employee: null,
      denied: Response.json({ error: scope.error }, { status: scope.status }),
    };
  }

  return { employee, denied: null };
}

async function organizationScheduleData(organizationId: number) {
  const [shifts, patterns, days, segments] = await Promise.all([
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
  ]);

  return { shifts, patterns, days, segments };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can review workforce schedules.",
  );
  if (denied) return denied;

  const employeeIdRaw = url.searchParams.get("employeeId");
  const date = String(url.searchParams.get("date") ?? "").trim();
  const startDate = String(url.searchParams.get("startDate") ?? "").trim();
  const endDate = String(url.searchParams.get("endDate") ?? "").trim();

  if (employeeIdRaw || date || startDate || endDate) {
    const employeeId = Number(employeeIdRaw);
    const singleDateMode = Boolean(date);
    const rangeMode = Boolean(startDate || endDate);
    const previewDates = singleDateMode
      ? (validDate(date) ? [date] : [])
      : (validDate(startDate) && validDate(endDate) ? inclusiveDates(startDate, endDate) : []);

    if (
      !Number.isInteger(employeeId)
      || (singleDateMode && rangeMode)
      || previewDates.length === 0
      || previewDates.length > 42
    ) {
      return Response.json({
        error: "employeeId plus either date, or startDate/endDate (YYYY-MM-DD, maximum 42 days), is required for schedule preview.",
      }, { status: 400 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;

    const data = await organizationScheduleData(organizationId);
    const rangeStart = previewDates[0];
    const rangeEnd = previewDates[previewDates.length - 1];
    const [assignments, overrides, worksiteAssignments] = await Promise.all([
      db.select().from(employeeScheduleAssignments).where(and(
        eq(employeeScheduleAssignments.organizationId, organizationId),
        eq(employeeScheduleAssignments.employeeId, employeeId),
      )).orderBy(asc(employeeScheduleAssignments.effectiveFrom), asc(employeeScheduleAssignments.id)),
      db.select().from(scheduleOverrides).where(and(
        eq(scheduleOverrides.organizationId, organizationId),
        eq(scheduleOverrides.employeeId, employeeId),
        gte(scheduleOverrides.workDate, rangeStart),
        lte(scheduleOverrides.workDate, rangeEnd),
      )).orderBy(asc(scheduleOverrides.workDate), asc(scheduleOverrides.id)),
      db.select().from(employeeWorksiteAssignments).where(and(
        eq(employeeWorksiteAssignments.organizationId, organizationId),
        eq(employeeWorksiteAssignments.employeeId, employeeId),
      )).orderBy(
        asc(employeeWorksiteAssignments.effectiveFrom),
        asc(employeeWorksiteAssignments.id),
      ),
    ]);

    const resolverInput = {
      assignments: assignments.map((row) => ({
        id: row.id,
        patternId: row.patternId,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        anchorDate: String(row.anchorDate),
        workLocationOrgUnitId: row.workLocationOrgUnitId,
        worksiteId: row.worksiteId,
      })),
      patterns: data.patterns.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        cycleDays: row.cycleDays,
      })),
      patternDays: data.days.map((row) => ({
        id: row.id,
        patternId: row.patternId,
        dayIndex: row.dayIndex,
        isRestDay: row.isRestDay,
        label: row.label,
      })),
      patternSegments: data.segments.map((row) => ({
        patternDayId: row.patternDayId,
        shiftDefinitionId: row.shiftDefinitionId,
        segmentOrder: row.segmentOrder,
      })),
      shifts: data.shifts.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        startTime: row.startTime,
        endTime: row.endTime,
        breakMinutes: row.breakMinutes,
        spansMidnight: row.spansMidnight,
      })),
      overrides: overrides.map((row) => ({
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
      })),
    };

    const defaultWorksites = worksiteAssignments.map((row) => ({
      id: row.id,
      worksiteId: row.worksiteId,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    }));

    const resolvedDays = previewDates.map((previewDate) => resolveDailySchedule({
      date: previewDate,
      ...resolverInput,
      defaultWorksiteId:
        selectEffectiveWorksiteAssignment(defaultWorksites, previewDate)?.worksiteId ?? null,
    }));
    const guardrailPolicy = await scheduleGuardrailPolicy(organizationId);
    const guardrailEvaluationDays = await resolveEmployeeScheduleWindow({
      organizationId,
      employeeId,
      startDate: addDays(previewDates[0], -7),
      endDate: previewDates[previewDates.length - 1],
    });
    const guardrailIssues = evaluateScheduleGuardrails({
      days: guardrailEvaluationDays,
      policy: guardrailPolicy,
    }).filter((issue) =>
      issue.date >= previewDates[0]
      && issue.date <= previewDates[previewDates.length - 1],
    );

    return Response.json({
      employee: {
        id: employeeCheck.employee!.id,
        employeeNo: employeeCheck.employee!.employeeNo,
        name: `${employeeCheck.employee!.firstName} ${employeeCheck.employee!.lastName}`,
      },
      resolved: resolvedDays.length === 1 ? resolvedDays[0] : null,
      resolvedDays,
      guardrailPolicy,
      guardrailIssues,
    });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const data = await organizationScheduleData(organizationId);
  const employeeRows = await db.select().from(employees)
    .where(eq(employees.organizationId, organizationId))
    .orderBy(asc(employees.id));
  const visibleEmployees = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => employee.id));

  const [assignmentRows, overrideRows, worksiteRows, worksiteAssignmentRows] = await Promise.all([
    db.select().from(employeeScheduleAssignments)
      .where(eq(employeeScheduleAssignments.organizationId, organizationId))
      .orderBy(asc(employeeScheduleAssignments.employeeId), asc(employeeScheduleAssignments.effectiveFrom)),
    db.select().from(scheduleOverrides)
      .where(eq(scheduleOverrides.organizationId, organizationId))
      .orderBy(asc(scheduleOverrides.workDate), asc(scheduleOverrides.employeeId)),
    db.select().from(worksites)
      .where(eq(worksites.organizationId, organizationId))
      .orderBy(asc(worksites.name), asc(worksites.id)),
    db.select().from(employeeWorksiteAssignments)
      .where(eq(employeeWorksiteAssignments.organizationId, organizationId))
      .orderBy(
        asc(employeeWorksiteAssignments.employeeId),
        asc(employeeWorksiteAssignments.effectiveFrom),
      ),
  ]);

  return Response.json({
    shifts: data.shifts,
    patterns: data.patterns,
    patternDays: data.days,
    patternSegments: data.segments,
    assignments: assignmentRows.filter((row) => visibleEmployeeIds.has(row.employeeId)),
    overrides: overrideRows.filter((row) => visibleEmployeeIds.has(row.employeeId)),
    worksites: worksiteRows.filter((site) =>
      access.companyWide || site.orgUnitId == null || site.orgUnitId === access.orgUnitId,
    ),
    worksiteAssignments: worksiteAssignmentRows.filter((row) => visibleEmployeeIds.has(row.employeeId)),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim();

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage workforce schedules.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `workforce-schedule-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_shift") {
    if (!access.companyWide) {
      return Response.json({
        error: "Organization-wide shift definitions require company-wide People access.",
      }, { status: 403 });
    }

    const code = cleanCode(body.code);
    const name = String(body.name ?? "").trim().slice(0, 120);
    const startTime = String(body.startTime ?? "").trim();
    const endTime = String(body.endTime ?? "").trim();
    const breakMinutes = Number(body.breakMinutes ?? 60);
    if (
      !code
      || !name
      || !TIME_OF_DAY.test(startTime)
      || !TIME_OF_DAY.test(endTime)
      || !Number.isInteger(breakMinutes)
      || breakMinutes < 0
      || breakMinutes > 480
    ) {
      return Response.json({
        error: "code, name, valid start/end times, and breakMinutes from 0 to 480 are required.",
      }, { status: 400 });
    }

    const spansMidnight = body.spansMidnight == null
      ? endTime <= startTime
      : Boolean(body.spansMidnight);

    try {
      const [created] = await db.insert(shiftDefinitions).values({
        organizationId,
        code,
        name,
        startTime,
        endTime,
        breakMinutes,
        spansMidnight,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Workforce shift definition created",
        resource: `${code} · ${name}`,
        metadata: { shiftDefinitionId: created.id, startTime, endTime, breakMinutes, spansMidnight },
      });

      return Response.json({ shift: created }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shift definition could not be created.";
      return Response.json({ error: message }, { status: 409 });
    }
  }

  if (action === "create_pattern") {
    if (!access.companyWide) {
      return Response.json({
        error: "Organization-wide schedule patterns require company-wide People access.",
      }, { status: 403 });
    }

    const code = cleanCode(body.code);
    const name = String(body.name ?? "").trim().slice(0, 120);
    type DraftPatternDay = {
      id: number;
      patternId: number;
      dayIndex: number;
      isRestDay: boolean;
      label: string | null;
    };
    type DraftPatternSegment = {
      patternDayId: number;
      shiftDefinitionId: number;
      segmentOrder: number;
    };

    const daysInput: Record<string, unknown>[] = Array.isArray(body.days)
      ? body.days.filter(
          (day: unknown): day is Record<string, unknown> =>
            typeof day === "object" && day !== null,
        )
      : [];
    const cycleDays = Number(body.cycleDays ?? daysInput.length);

    if (!code || !name || !Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > 56) {
      return Response.json({
        error: "code, name, and cycleDays from 1 to 56 are required.",
      }, { status: 400 });
    }
    if (daysInput.length !== cycleDays) {
      return Response.json({
        error: "days must contain exactly one entry for every day in the cycle.",
      }, { status: 400 });
    }

    const shifts = await db.select().from(shiftDefinitions)
      .where(eq(shiftDefinitions.organizationId, organizationId));
    const shiftIds = new Set(shifts.map((shift) => shift.id));

    const fakeDays: DraftPatternDay[] = daysInput.map((day, dayIndex) => ({
      id: dayIndex + 1,
      patternId: -1,
      dayIndex,
      isRestDay: Boolean(day.isRestDay),
      label: String(day.label ?? "").trim().slice(0, 80) || null,
    }));
    const fakeSegments: DraftPatternSegment[] = fakeDays.flatMap(
      (day: DraftPatternDay, dayIndex: number) => {
      const raw = Array.isArray((daysInput[dayIndex] as Record<string, unknown>).segments)
        ? (daysInput[dayIndex] as Record<string, unknown>).segments as unknown[]
        : [];
        return raw.map((value, index): DraftPatternSegment => ({
          patternDayId: day.id,
          shiftDefinitionId:
            typeof value === "object" && value
              ? Number((value as Record<string, unknown>).shiftDefinitionId)
              : Number(value),
          segmentOrder: index + 1,
        }));
      },
    );
    const invalidSegment = fakeSegments.find(
      (segment: DraftPatternSegment) => !shiftIds.has(segment.shiftDefinitionId),
    );
    if (invalidSegment) {
      return Response.json({
        error: "Every pattern shift must belong to this organization.",
      }, { status: 422 });
    }

    try {
      validateSchedulePattern({
        pattern: { id: -1, code, name, cycleDays },
        days: fakeDays,
        segments: fakeSegments,
        shifts: shifts.map((shift) => ({
          id: shift.id,
          code: shift.code,
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          breakMinutes: shift.breakMinutes,
          spansMidnight: shift.spansMidnight,
        })),
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Schedule pattern is invalid.",
      }, { status: 422 });
    }

    try {
      const created = await db.transaction(async (tx) => {
        const [pattern] = await tx.insert(schedulePatterns).values({
          organizationId,
          code,
          name,
          cycleDays,
        }).returning();

        const createdDays = [];
        for (let dayIndex = 0; dayIndex < fakeDays.length; dayIndex += 1) {
          const day = fakeDays[dayIndex];
          const [createdDay] = await tx.insert(schedulePatternDays).values({
            patternId: pattern.id,
            dayIndex,
            isRestDay: day.isRestDay,
            label: day.label,
          }).returning();
          createdDays.push(createdDay);

          const daySegments = fakeSegments.filter(
            (segment: DraftPatternSegment) => segment.patternDayId === day.id,
          );
          for (const segment of daySegments) {
            await tx.insert(schedulePatternSegments).values({
              patternDayId: createdDay.id,
              shiftDefinitionId: segment.shiftDefinitionId,
              segmentOrder: segment.segmentOrder,
            });
          }
        }

        return { pattern, days: createdDays };
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Workforce schedule pattern created",
        resource: `${code} · ${name}`,
        metadata: { patternId: created.pattern.id, cycleDays },
      });

      return Response.json(created, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Schedule pattern could not be created.";
      return Response.json({ error: message }, { status: 409 });
    }
  }

  if (action === "assign_schedule") {
    const employeeId = Number(body.employeeId);
    const patternId = Number(body.patternId);
    const effectiveFrom = String(body.effectiveFrom ?? "").trim();
    const effectiveUntil = String(body.effectiveUntil ?? "").trim() || null;
    const anchorDate = String(body.anchorDate ?? effectiveFrom).trim();
    const reason = String(body.reason ?? "Schedule assignment").trim().slice(0, 240);

    if (
      !Number.isInteger(employeeId)
      || !Number.isInteger(patternId)
      || !validDate(effectiveFrom)
      || !validDate(anchorDate)
      || (effectiveUntil && !validDate(effectiveUntil))
      || (effectiveUntil && effectiveUntil < effectiveFrom)
    ) {
      return Response.json({
        error: "employeeId, patternId, effectiveFrom, anchorDate, and a valid optional effectiveUntil are required.",
      }, { status: 400 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;

    const [pattern] = await db.select().from(schedulePatterns).where(and(
      eq(schedulePatterns.id, patternId),
      eq(schedulePatterns.organizationId, organizationId),
    )).limit(1);
    if (!pattern) {
      return Response.json({ error: "Schedule pattern not found in this organization." }, { status: 404 });
    }

    const worksiteId = body.worksiteId == null || body.worksiteId === ""
      ? null
      : Number(body.worksiteId);
    if (worksiteId != null && !Number.isInteger(worksiteId)) {
      return Response.json({ error: "worksiteId must be an integer or null." }, { status: 400 });
    }
    if (worksiteId != null) {
      const [site] = await db.select().from(worksites).where(and(
        eq(worksites.id, worksiteId),
        eq(worksites.organizationId, organizationId),
        eq(worksites.active, true),
      )).limit(1);
      if (!site) {
        return Response.json({ error: "Active worksite does not belong to this organization." }, { status: 422 });
      }
      if (!access.companyWide && site.orgUnitId != null && site.orgUnitId !== access.orgUnitId) {
        return Response.json({ error: "Scoped People administrators cannot assign this worksite." }, { status: 403 });
      }
    }

    const workLocationOrgUnitId = body.workLocationOrgUnitId == null
      ? employeeCheck.employee!.orgUnitId
      : Number(body.workLocationOrgUnitId);
    if (workLocationOrgUnitId != null && !Number.isInteger(workLocationOrgUnitId)) {
      return Response.json({ error: "workLocationOrgUnitId must be an integer or null." }, { status: 400 });
    }
    if (workLocationOrgUnitId != null) {
      const [workLocation] = await db.select({ id: orgUnits.id }).from(orgUnits).where(and(
        eq(orgUnits.id, workLocationOrgUnitId),
        eq(orgUnits.organizationId, organizationId),
      )).limit(1);
      if (!workLocation) {
        return Response.json({ error: "Work location does not belong to this organization." }, { status: 422 });
      }
      if (!access.companyWide && workLocationOrgUnitId !== access.orgUnitId) {
        return Response.json({ error: "Scoped People administrators cannot assign work outside their organization unit." }, { status: 403 });
      }
    }

    if (worksiteId != null) {
      const eligibility = await employeeSiteEligibility({
        organizationId, employeeId, worksiteId, date: effectiveFrom,
      });
      if (!eligibility.eligible) {
        return Response.json({
          error: "Work arrangement or site authorization does not permit this schedule.",
          siteEligibility: eligibility,
        }, { status: 409 });
      }
    }

    const guardrailPolicy = await scheduleGuardrailPolicy(organizationId);
    let guardrailIssues;
    try {
      const prospectiveDays = await resolveEmployeeScheduleWindow({
        organizationId,
        employeeId,
        startDate: addDays(effectiveFrom, -7),
        endDate: addDays(effectiveFrom, 13),
        prospectiveAssignment: {
          id: Number.MAX_SAFE_INTEGER,
          patternId,
          effectiveFrom,
          effectiveUntil,
          anchorDate,
          workLocationOrgUnitId,
          worksiteId,
        },
      });
      guardrailIssues = evaluateScheduleGuardrails({
        days: prospectiveDays,
        policy: guardrailPolicy,
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Could not validate the prospective schedule.",
      }, { status: 409 });
    }

    if (scheduleGuardrailBlocksMutation(guardrailIssues)) {
      return Response.json({
        error: "WFM schedule guardrails blocked this roster assignment.",
        guardrailIssues,
      }, { status: 409 });
    }

    try {
      const result = await db.transaction(async (tx) => {
        // Serialize ALL roster mutations on this employer with governed bulk
        // approval, then recheck source evidence before the write.
        await tx.execute(sql`select pg_advisory_xact_lock(6107, ${organizationId})`);
        const lockedPolicy = await scheduleGuardrailPolicy(organizationId, tx);
        const lockedWindow = await resolveEmployeeScheduleWindow({
          organizationId,
          employeeId,
          startDate: addDays(effectiveFrom, -7),
          endDate: addDays(effectiveFrom, 13),
          prospectiveAssignment: {
            id: Number.MAX_SAFE_INTEGER, patternId, effectiveFrom,
            effectiveUntil, anchorDate, workLocationOrgUnitId, worksiteId,
          },
          executor: tx,
        });
        const lockedIssues = evaluateScheduleGuardrails({
          days: lockedWindow, policy: lockedPolicy,
        });
        if (scheduleGuardrailBlocksMutation(lockedIssues)) {
          throw new Error("Concurrent roster changes now breach workforce assignment guardrails.");
        }
        const [created] = await tx.insert(employeeScheduleAssignments).values({
          organizationId, employeeId, patternId, effectiveFrom, effectiveUntil,
          anchorDate, workLocationOrgUnitId, worksiteId, reason, createdBy: user.name,
        }).returning();
        const staleTimesheets = await markTimesheetsStaleForEmployeeRange({
          organizationId, employeeId, startDate: effectiveFrom,
          endDate: effectiveUntil, executor: tx,
        });
        await tx.insert(auditEvents).values({
          organizationId,
          actor: user.name,
          action: "Employee workforce schedule assigned",
          resource: `${employeeCheck.employee!.employeeNo} · ${pattern.code}`,
          metadata: {
            assignmentId: created.id, employeeId, patternId, effectiveFrom,
            effectiveUntil, anchorDate, workLocationOrgUnitId, worksiteId,
            staleTimesheetIds: staleTimesheets.map((row) => row.id),
          },
        });
        return { created, staleTimesheets, lockedIssues, lockedPolicy };
      }, { isolationLevel: "serializable" });

      return Response.json({
        assignment: result.created,
        guardrailIssues: result.lockedIssues,
        guardrailPolicy: result.lockedPolicy,
        staleTimesheetIds: result.staleTimesheets.map((row) => row.id),
      }, { status: 201 });
    } catch {
      // Serialization conflicts, evidence changes and DB errors are all no-commit.
      return Response.json({
        error: "The roster changed while this assignment was being saved. Refresh the schedule and retry.",
        code: "WFM_ASSIGNMENT_SOURCE_CHANGED",
      }, { status: 409 });
    }
  }

  if (action === "create_override") {
    const employeeId = Number(body.employeeId);
    const workDate = String(body.workDate ?? "").trim();
    const kind = String(body.kind ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 240);
    if (!Number.isInteger(employeeId) || !validDate(workDate) || !OVERRIDE_KINDS.has(kind) || !reason) {
      return Response.json({
        error: "employeeId, workDate, kind, and reason are required.",
      }, { status: 400 });
    }

    const employeeCheck = await scopedEmployee(user.id, organizationId, employeeId);
    if (employeeCheck.denied) return employeeCheck.denied;

    const isRestDay = Boolean(body.isRestDay) || kind === "rest_day" || kind === "off";
    const rawSegments = Array.isArray(body.segments) ? body.segments : [];
    const segments: WorkforceScheduleOverrideSegment[] = rawSegments.map(
      (segment: unknown, index: number) => ({
        shiftDefinitionId:
          typeof segment === "object" && segment
            ? Number((segment as Record<string, unknown>).shiftDefinitionId)
            : Number(segment),
        segmentOrder: index + 1,
      }),
    );

    if (!isRestDay && kind !== "location" && segments.length === 0) {
      return Response.json({ error: "A working shift override requires at least one shift segment." }, { status: 422 });
    }

    if (segments.length > 0) {
      const shifts = await db.select().from(shiftDefinitions)
        .where(eq(shiftDefinitions.organizationId, organizationId));
      const shiftIds = new Set(shifts.map((shift) => shift.id));
      if (segments.some((segment) => !shiftIds.has(segment.shiftDefinitionId))) {
        return Response.json({
          error: "Every override shift must belong to this organization.",
        }, { status: 422 });
      }
    }

    const worksiteId = body.worksiteId == null || body.worksiteId === ""
      ? null
      : Number(body.worksiteId);
    if (worksiteId != null && !Number.isInteger(worksiteId)) {
      return Response.json({ error: "worksiteId must be an integer or null." }, { status: 400 });
    }
    if (worksiteId != null) {
      const [site] = await db.select().from(worksites).where(and(
        eq(worksites.id, worksiteId),
        eq(worksites.organizationId, organizationId),
        eq(worksites.active, true),
      )).limit(1);
      if (!site) {
        return Response.json({ error: "Active worksite does not belong to this organization." }, { status: 422 });
      }
      if (!access.companyWide && site.orgUnitId != null && site.orgUnitId !== access.orgUnitId) {
        return Response.json({ error: "Scoped People administrators cannot override to this worksite." }, { status: 403 });
      }
    }

    const workLocationOrgUnitId = body.workLocationOrgUnitId == null
      ? null
      : Number(body.workLocationOrgUnitId);
    if (workLocationOrgUnitId != null && !Number.isInteger(workLocationOrgUnitId)) {
      return Response.json({ error: "workLocationOrgUnitId must be an integer or null." }, { status: 400 });
    }
    if (workLocationOrgUnitId != null) {
      const [workLocation] = await db.select({ id: orgUnits.id }).from(orgUnits).where(and(
        eq(orgUnits.id, workLocationOrgUnitId),
        eq(orgUnits.organizationId, organizationId),
      )).limit(1);
      if (!workLocation) {
        return Response.json({ error: "Work location does not belong to this organization." }, { status: 422 });
      }
      if (!access.companyWide && workLocationOrgUnitId !== access.orgUnitId) {
        return Response.json({ error: "Scoped People administrators cannot override work outside their organization unit." }, { status: 403 });
      }
    }

    if (worksiteId != null) {
      const eligibility = await employeeSiteEligibility({
        organizationId, employeeId, worksiteId, date: workDate,
      });
      if (!eligibility.eligible) {
        return Response.json({
          error: "Work arrangement or site authorization does not permit this override.",
          siteEligibility: eligibility,
        }, { status: 409 });
      }
    }

    const guardrailPolicy = await scheduleGuardrailPolicy(organizationId);
    let guardrailIssues;
    try {
      const prospectiveDays = await resolveEmployeeScheduleWindow({
        organizationId,
        employeeId,
        startDate: addDays(workDate, -7),
        endDate: addDays(workDate, 7),
        prospectiveOverride: {
          id: Number.MAX_SAFE_INTEGER,
          workDate,
          kind: kind as "shift" | "split_shift" | "rest_day" | "off" | "location",
          isRestDay,
          segments,
          workLocationOrgUnitId,
          worksiteId,
          status: "approved",
          reason,
        },
      });
      guardrailIssues = evaluateScheduleGuardrails({
        days: prospectiveDays,
        policy: guardrailPolicy,
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Could not validate the prospective override.",
      }, { status: 409 });
    }

    if (scheduleGuardrailBlocksMutation(guardrailIssues)) {
      return Response.json({
        error: "WFM schedule guardrails blocked this roster override.",
        guardrailIssues,
      }, { status: 409 });
    }

    try {
      const [created] = await db.insert(scheduleOverrides).values({
        organizationId,
        employeeId,
        workDate,
        kind,
        isRestDay,
        segments,
        workLocationOrgUnitId,
        worksiteId,
        reason,
        status: "approved",
        createdBy: user.name,
        approvedBy: user.name,
        approvedAt: new Date(),
      }).returning();

      const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
        organizationId,
        employeeId,
        workDate,
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Employee schedule override created",
        resource: `${employeeCheck.employee!.employeeNo} · ${workDate}`,
        metadata: {
          overrideId: created.id,
          employeeId,
          workDate,
          kind,
          isRestDay,
          shiftSegments: segments,
          workLocationOrgUnitId,
          worksiteId,
          reason,
          staleTimesheetIds: staleTimesheets.map((row) => row.id),
        },
      });

      return Response.json({
        override: created,
        guardrailIssues,
        guardrailPolicy,
        staleTimesheetIds: staleTimesheets.map((row) => row.id),
      }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Schedule override could not be created.";
      return Response.json({ error: message }, { status: 409 });
    }
  }

  return Response.json({
    error: "Unsupported action. Use create_shift, create_pattern, assign_schedule, or create_override.",
  }, { status: 400 });
}
