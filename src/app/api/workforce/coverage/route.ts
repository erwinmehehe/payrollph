import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeAvailabilityRules,
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  employees,
  openShiftClaims,
  openShifts,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  staffingRequirements,
  workforceScheduleGuardrailPolicies,
  worksites,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  availabilityConflictForShift,
  computeCoverage,
  preferredForShift,
  remainingOpenShiftSlots,
  type AvailabilityRule,
} from "@/lib/workforce-coverage";
import {
  DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
  evaluateScheduleGuardrails,
  scheduleGuardrailBlocksMutation,
} from "@/lib/workforce-schedule-guardrails";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import {
  resolveDailySchedule,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function datesBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end && dates.length <= 14; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

async function visibleWorkforce(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) return null;

  const [employeeRows, worksiteRows] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(worksites)
      .where(eq(worksites.organizationId, organizationId))
      .orderBy(asc(worksites.name)),
  ]);

  const visibleEmployees = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleWorksites = worksiteRows.filter((site) =>
    access.companyWide || site.orgUnitId == null || site.orgUnitId === access.orgUnitId,
  );

  return { access, visibleEmployees, visibleWorksites };
}

async function scheduleCatalog(organizationId: number) {
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

async function coverageRows(input: {
  organizationId: number;
  employeeIds: number[];
  startDate: string;
  endDate: string;
  requirements: Array<typeof staffingRequirements.$inferSelect>;
  availabilityRows: Array<typeof employeeAvailabilityRules.$inferSelect>;
}) {
  if (input.employeeIds.length === 0) return [];

  const data = await scheduleCatalog(input.organizationId);
  const [assignmentRows, overrideRows, worksiteRows] = await Promise.all([
    db.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, input.organizationId),
      inArray(employeeScheduleAssignments.employeeId, input.employeeIds),
    )).orderBy(asc(employeeScheduleAssignments.employeeId), asc(employeeScheduleAssignments.effectiveFrom)),
    db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, input.organizationId),
      inArray(scheduleOverrides.employeeId, input.employeeIds),
      gte(scheduleOverrides.workDate, input.startDate),
      lte(scheduleOverrides.workDate, input.endDate),
    )).orderBy(asc(scheduleOverrides.employeeId), asc(scheduleOverrides.workDate)),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, input.organizationId),
      inArray(employeeWorksiteAssignments.employeeId, input.employeeIds),
    )).orderBy(asc(employeeWorksiteAssignments.employeeId), asc(employeeWorksiteAssignments.effectiveFrom)),
  ]);

  const shiftsById = new Map(data.shifts.map((shift) => [shift.id, shift]));
  const dates = datesBetween(input.startDate, input.endDate);
  const scheduled = [];

  for (const employeeId of input.employeeIds) {
    const employeeAssignments = assignmentRows.filter((row) => row.employeeId === employeeId);
    const employeeOverrides = overrideRows.filter((row) => row.employeeId === employeeId);
    const defaultWorksites = worksiteRows
      .filter((row) => row.employeeId === employeeId)
      .map((row) => ({
        id: row.id,
        worksiteId: row.worksiteId,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      }));
    const availability: AvailabilityRule[] = input.availabilityRows
      .filter((row) => row.employeeId === employeeId)
      .map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        weekday: row.weekday,
        startTime: row.startTime,
        endTime: row.endTime,
        availabilityType: row.availabilityType === "preferred" ? "preferred" : "unavailable",
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      }));

    for (const date of dates) {
      const day = resolveDailySchedule({
        date,
        assignments: employeeAssignments.map((row) => ({
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
        patternDays: data.days,
        patternSegments: data.segments,
        shifts: data.shifts.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          startTime: row.startTime,
          endTime: row.endTime,
          breakMinutes: row.breakMinutes,
          spansMidnight: row.spansMidnight,
        })),
        overrides: employeeOverrides.map((row) => ({
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
        defaultWorksiteId:
          selectEffectiveWorksiteAssignment(defaultWorksites, date)?.worksiteId ?? null,
      });

      const shiftIds = day.segments.map((segment) => segment.shiftDefinitionId);
      const unavailableShiftIds = shiftIds.filter((shiftId) => {
        const shift = shiftsById.get(shiftId);
        return shift ? availabilityConflictForShift({ rules: availability, date, shift }) : false;
      });

      scheduled.push({
        employeeId,
        workDate: date,
        worksiteId: day.worksiteId,
        shiftDefinitionIds: shiftIds,
        unavailableShiftDefinitionIds: unavailableShiftIds,
      });
    }
  }

  return computeCoverage({
    requirements: input.requirements.map((row) => ({
      id: row.id,
      worksiteId: row.worksiteId,
      workDate: String(row.workDate),
      shiftDefinitionId: row.shiftDefinitionId,
      requiredHeadcount: row.requiredHeadcount,
    })),
    scheduled,
  });
}

async function loadGuardrailPolicy(organizationId: number) {
  const [row] = await db.select().from(workforceScheduleGuardrailPolicies)
    .where(eq(workforceScheduleGuardrailPolicies.organizationId, organizationId))
    .limit(1);
  if (!row) return DEFAULT_SCHEDULE_GUARDRAIL_POLICY;
  return {
    minimumRestMinutes: row.minimumRestMinutes,
    maxConsecutiveWorkingDays: row.maxConsecutiveWorkingDays,
    rollingSevenDayMinutes: row.rollingSevenDayMinutes,
    enforcementMode: row.enforcementMode === "block" ? "block" as const : "advisory" as const,
    active: row.active,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const startDate = String(url.searchParams.get("startDate") ?? "");
  const endDate = String(url.searchParams.get("endDate") ?? "");
  const dates = datesBetween(startDate, endDate);

  if (!Number.isInteger(organizationId) || !ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || dates.length === 0) {
    return Response.json({
      error: "organizationId plus startDate/endDate (YYYY-MM-DD, maximum 14 days) are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can review coverage planning.",
  );
  if (denied) return denied;

  const workforce = await visibleWorkforce(user.id, organizationId);
  if (!workforce) return Response.json({ error: "Workspace access not found." }, { status: 403 });

  const employeeIds = workforce.visibleEmployees.map((employee) => employee.id);
  const worksiteIds = workforce.visibleWorksites.map((site) => site.id);

  const [requirements, availability, openShiftRows, claimRows, shifts] = await Promise.all([
    worksiteIds.length
      ? db.select().from(staffingRequirements).where(and(
          eq(staffingRequirements.organizationId, organizationId),
          inArray(staffingRequirements.worksiteId, worksiteIds),
          gte(staffingRequirements.workDate, startDate),
          lte(staffingRequirements.workDate, endDate),
        )).orderBy(asc(staffingRequirements.workDate), asc(staffingRequirements.worksiteId))
      : [],
    employeeIds.length
      ? db.select().from(employeeAvailabilityRules).where(and(
          eq(employeeAvailabilityRules.organizationId, organizationId),
          inArray(employeeAvailabilityRules.employeeId, employeeIds),
          lte(employeeAvailabilityRules.effectiveFrom, endDate),
        )).orderBy(asc(employeeAvailabilityRules.employeeId), asc(employeeAvailabilityRules.weekday))
      : [],
    worksiteIds.length
      ? db.select().from(openShifts).where(and(
          eq(openShifts.organizationId, organizationId),
          inArray(openShifts.worksiteId, worksiteIds),
          gte(openShifts.workDate, startDate),
          lte(openShifts.workDate, endDate),
        )).orderBy(asc(openShifts.workDate), asc(openShifts.id))
      : [],
    db.select().from(openShiftClaims)
      .where(eq(openShiftClaims.organizationId, organizationId))
      .orderBy(asc(openShiftClaims.openShiftId), asc(openShiftClaims.id)),
    db.select().from(shiftDefinitions)
      .where(eq(shiftDefinitions.organizationId, organizationId))
      .orderBy(asc(shiftDefinitions.code)),
  ]);

  const coverage = await coverageRows({
    organizationId,
    employeeIds,
    startDate,
    endDate,
    requirements,
    availabilityRows: availability,
  });

  return Response.json({
    employees: workforce.visibleEmployees.map((employee) => ({
      id: employee.id,
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
      orgUnitId: employee.orgUnitId,
    })),
    worksites: workforce.visibleWorksites,
    shifts,
    requirements,
    availability,
    coverage,
    openShifts: openShiftRows.map((row) => {
      const approved = claimRows.filter((claim) =>
        claim.openShiftId === row.id && claim.status === "approved",
      ).length;
      return {
        ...row,
        approvedClaims: approved,
        remainingSlots: remainingOpenShiftSlots({ slots: row.slots, approvedClaims: approved }),
      };
    }),
    claims: claimRows.filter((claim) =>
      openShiftRows.some((shift) => shift.id === claim.openShiftId)
      && employeeIds.includes(claim.employeeId),
    ),
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
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `wfm-coverage-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 60,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_availability") {
    const employeeId = Number(body.employeeId);
    const weekday = Number(body.weekday);
    const startTime = String(body.startTime ?? "");
    const endTime = String(body.endTime ?? "");
    const availabilityType = String(body.availabilityType ?? "unavailable");
    const effectiveFrom = String(body.effectiveFrom ?? "");
    const effectiveUntil = String(body.effectiveUntil ?? "") || null;
    const notes = String(body.notes ?? "").trim().slice(0, 240) || null;

    const selfService = user.employeeId === employeeId;
    if (!selfService) {
      const denied = await assertOrganizationRole(
        user.id,
        organizationId,
        WORKFORCE_MANAGER_ROLES,
        "Only workforce managers can set availability for another employee.",
      );
      if (denied) return denied;
    }

    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    if (
      !Number.isInteger(weekday) || weekday < 0 || weekday > 6
      || !TIME.test(startTime) || !TIME.test(endTime)
      || !["unavailable", "preferred"].includes(availabilityType)
      || !ISO_DATE.test(effectiveFrom)
      || (effectiveUntil && (!ISO_DATE.test(effectiveUntil) || effectiveUntil < effectiveFrom))
    ) {
      return Response.json({ error: "Use a weekday 0-6, valid times, unavailable/preferred type, and valid effective dates." }, { status: 400 });
    }

    const [created] = await db.insert(employeeAvailabilityRules).values({
      organizationId,
      employeeId,
      weekday,
      startTime,
      endTime,
      availabilityType,
      effectiveFrom,
      effectiveUntil,
      notes,
      createdBy: user.name,
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee WFM availability rule created",
      resource: `${employee.employeeNo} · weekday ${weekday}`,
      metadata: { availabilityRuleId: created.id, employeeId, weekday, startTime, endTime, availabilityType, effectiveFrom, effectiveUntil },
    });

    return Response.json({ availability: created }, { status: 201 });
  }

  const managerDenied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can manage coverage requirements and open shifts.",
  );
  if (managerDenied && action !== "claim_open_shift") return managerDenied;

  if (action === "create_requirement") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const worksiteId = Number(body.worksiteId);
    const shiftDefinitionId = Number(body.shiftDefinitionId);
    const workDate = String(body.workDate ?? "");
    const requiredHeadcount = Number(body.requiredHeadcount);
    const notes = String(body.notes ?? "").trim().slice(0, 240) || null;

    if (!Number.isInteger(worksiteId) || !Number.isInteger(shiftDefinitionId) || !ISO_DATE.test(workDate)
      || !Number.isInteger(requiredHeadcount) || requiredHeadcount < 1 || requiredHeadcount > 10000) {
      return Response.json({ error: "worksiteId, shiftDefinitionId, workDate and positive requiredHeadcount are required." }, { status: 400 });
    }

    const [site, shift] = await Promise.all([
      db.select().from(worksites).where(and(
        eq(worksites.id, worksiteId),
        eq(worksites.organizationId, organizationId),
      )).limit(1),
      db.select().from(shiftDefinitions).where(and(
        eq(shiftDefinitions.id, shiftDefinitionId),
        eq(shiftDefinitions.organizationId, organizationId),
      )).limit(1),
    ]);
    if (!site[0] || !shift[0]) return Response.json({ error: "Worksite or shift does not belong to this organization." }, { status: 422 });
    const scope = assertScope(access, site[0].orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const [existing] = await db.select().from(staffingRequirements).where(and(
      eq(staffingRequirements.organizationId, organizationId),
      eq(staffingRequirements.worksiteId, worksiteId),
      eq(staffingRequirements.workDate, workDate),
      eq(staffingRequirements.shiftDefinitionId, shiftDefinitionId),
    )).limit(1);

    const [saved] = existing
      ? await db.update(staffingRequirements).set({
          requiredHeadcount,
          notes,
          updatedAt: new Date(),
        }).where(eq(staffingRequirements.id, existing.id)).returning()
      : await db.insert(staffingRequirements).values({
          organizationId,
          worksiteId,
          workDate,
          shiftDefinitionId,
          requiredHeadcount,
          notes,
          createdBy: user.name,
          createdByUserId: user.id,
        }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: existing ? "WFM staffing requirement updated" : "WFM staffing requirement created",
      resource: `${site[0].code} · ${workDate} · ${shift[0].code}`,
      metadata: { requirementId: saved.id, worksiteId, workDate, shiftDefinitionId, requiredHeadcount },
    });

    return Response.json({ requirement: saved }, { status: existing ? 200 : 201 });
  }

  if (action === "create_open_shift") {
    const worksiteId = Number(body.worksiteId);
    const shiftDefinitionId = Number(body.shiftDefinitionId);
    const workDate = String(body.workDate ?? "");
    const slots = Number(body.slots ?? 1);
    const sourceRequirementId = body.sourceRequirementId == null ? null : Number(body.sourceRequirementId);
    const reason = String(body.reason ?? "Coverage gap").trim().slice(0, 240);

    if (!Number.isInteger(worksiteId) || !Number.isInteger(shiftDefinitionId) || !ISO_DATE.test(workDate)
      || !Number.isInteger(slots) || slots < 1 || slots > 1000 || !reason) {
      return Response.json({ error: "Valid worksite, shift, date, slots and reason are required." }, { status: 400 });
    }

    const [site, shift] = await Promise.all([
      db.select().from(worksites).where(and(eq(worksites.id, worksiteId), eq(worksites.organizationId, organizationId))).limit(1),
      db.select().from(shiftDefinitions).where(and(eq(shiftDefinitions.id, shiftDefinitionId), eq(shiftDefinitions.organizationId, organizationId))).limit(1),
    ]);
    if (!site[0] || !shift[0]) return Response.json({ error: "Worksite or shift not found." }, { status: 404 });
    const scope = assertScope(access, site[0].orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    if (sourceRequirementId != null) {
      const [requirement] = await db.select().from(staffingRequirements).where(and(
        eq(staffingRequirements.id, sourceRequirementId),
        eq(staffingRequirements.organizationId, organizationId),
      )).limit(1);
      if (!requirement
        || requirement.worksiteId !== worksiteId
        || String(requirement.workDate) !== workDate
        || requirement.shiftDefinitionId !== shiftDefinitionId) {
        return Response.json({ error: "sourceRequirementId does not match this worksite/date/shift." }, { status: 422 });
      }
    }

    const [created] = await db.insert(openShifts).values({
      organizationId,
      worksiteId,
      workDate,
      shiftDefinitionId,
      slots,
      status: "open",
      sourceRequirementId,
      reason,
      createdBy: user.name,
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "WFM open shift created",
      resource: `${site[0].code} · ${workDate} · ${shift[0].code}`,
      metadata: { openShiftId: created.id, slots, sourceRequirementId, reason },
    });

    return Response.json({ openShift: created }, { status: 201 });
  }

  if (action === "claim_open_shift") {
    const openShiftId = Number(body.openShiftId);
    const requestedEmployeeId = body.employeeId == null ? user.employeeId : Number(body.employeeId);
    const reason = String(body.reason ?? "Open shift claim").trim().slice(0, 240);
    if (!Number.isInteger(openShiftId) || requestedEmployeeId == null || !Number.isInteger(requestedEmployeeId) || !reason) {
      return Response.json({ error: "openShiftId, employee identity and reason are required." }, { status: 400 });
    }
    const employeeId = Number(requestedEmployeeId);
    const selfService = user.employeeId === employeeId;
    if (!selfService) {
      const denied = await assertOrganizationRole(
        user.id,
        organizationId,
        WORKFORCE_MANAGER_ROLES,
        "Only workforce managers can submit an open-shift claim for another employee.",
      );
      if (denied) return denied;
    }

    const [[shiftRow], [employee]] = await Promise.all([
      db.select().from(openShifts).where(and(
        eq(openShifts.id, openShiftId),
        eq(openShifts.organizationId, organizationId),
      )).limit(1),
      db.select().from(employees).where(and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1),
    ]);
    if (!shiftRow || !employee) return Response.json({ error: "Open shift or employee not found." }, { status: 404 });
    if (shiftRow.status !== "open") return Response.json({ error: "This open shift is no longer accepting claims." }, { status: 409 });

    const employeeScope = assertScope(access, employee.orgUnitId);
    if (!employeeScope.ok) return Response.json({ error: employeeScope.error }, { status: employeeScope.status });

    const [shiftDefinition] = await db.select().from(shiftDefinitions).where(and(
      eq(shiftDefinitions.id, shiftRow.shiftDefinitionId),
      eq(shiftDefinitions.organizationId, organizationId),
    )).limit(1);
    const availabilityRows = await db.select().from(employeeAvailabilityRules).where(and(
      eq(employeeAvailabilityRules.organizationId, organizationId),
      eq(employeeAvailabilityRules.employeeId, employeeId),
      lte(employeeAvailabilityRules.effectiveFrom, shiftRow.workDate),
    ));
    const availability: AvailabilityRule[] = availabilityRows.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      weekday: row.weekday,
      startTime: row.startTime,
      endTime: row.endTime,
      availabilityType: row.availabilityType === "preferred" ? "preferred" : "unavailable",
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    }));
    if (!shiftDefinition || availabilityConflictForShift({
      rules: availability,
      date: String(shiftRow.workDate),
      shift: shiftDefinition,
    })) {
      return Response.json({ error: "The employee is unavailable for this open shift." }, { status: 409 });
    }

    const current = await resolveEmployeeScheduleWindow({
      organizationId,
      employeeId,
      startDate: String(shiftRow.workDate),
      endDate: String(shiftRow.workDate),
    });
    if (current[0] && !current[0].isRestDay && current[0].segments.length > 0) {
      return Response.json({
        error: "Open shifts can only be claimed on an unassigned/rest day. Use overtime or a schedule change for an already scheduled employee.",
      }, { status: 409 });
    }

    const [created] = await db.insert(openShiftClaims).values({
      organizationId,
      openShiftId,
      employeeId,
      status: "pending",
      reason,
      requestedBy: user.name,
      requestedByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "WFM open shift claimed",
      resource: `${employee.employeeNo} · ${shiftRow.workDate}`,
      metadata: {
        claimId: created.id,
        openShiftId,
        employeeId,
        preferred: preferredForShift({ rules: availability, date: String(shiftRow.workDate), shift: shiftDefinition }),
      },
    });

    return Response.json({ claim: created }, { status: 201 });
  }

  if (action === "decide_claim") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const claimId = Number(body.claimId);
    const decision = String(body.decision ?? "");
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 240) || null;
    if (!Number.isInteger(claimId) || !["approved", "rejected"].includes(decision)) {
      return Response.json({ error: "claimId and approved/rejected decision are required." }, { status: 400 });
    }

    const [claim] = await db.select().from(openShiftClaims).where(and(
      eq(openShiftClaims.id, claimId),
      eq(openShiftClaims.organizationId, organizationId),
    )).limit(1);
    if (!claim) return Response.json({ error: "Open shift claim not found." }, { status: 404 });
    if (claim.status !== "pending") return Response.json({ error: "Only pending claims can be decided." }, { status: 409 });

    const [[openShift], [employee]] = await Promise.all([
      db.select().from(openShifts).where(and(
        eq(openShifts.id, claim.openShiftId),
        eq(openShifts.organizationId, organizationId),
      )).limit(1),
      db.select().from(employees).where(and(
        eq(employees.id, claim.employeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1),
    ]);
    if (!openShift || !employee) return Response.json({ error: "Open shift or employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    if (decision === "rejected") {
      const [updated] = await db.update(openShiftClaims).set({
        status: "rejected",
        decidedBy: user.name,
        decidedByUserId: user.id,
        decidedAt: new Date(),
        decisionNote,
        updatedAt: new Date(),
      }).where(eq(openShiftClaims.id, claimId)).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "WFM open shift claim rejected",
        resource: `${employee.employeeNo} · ${openShift.workDate}`,
        metadata: { claimId, openShiftId: openShift.id, employeeId: employee.id, decisionNote },
      });
      return Response.json({ claim: updated });
    }

    if (openShift.status !== "open") {
      return Response.json({ error: "This open shift is already filled or cancelled." }, { status: 409 });
    }

    const [shift] = await db.select().from(shiftDefinitions).where(and(
      eq(shiftDefinitions.id, openShift.shiftDefinitionId),
      eq(shiftDefinitions.organizationId, organizationId),
    )).limit(1);
    if (!shift) return Response.json({ error: "Shift definition not found." }, { status: 404 });

    const [existingOverride] = await db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, organizationId),
      eq(scheduleOverrides.employeeId, employee.id),
      eq(scheduleOverrides.workDate, openShift.workDate),
    )).limit(1);
    if (existingOverride) {
      return Response.json({ error: "Employee already has a day-level schedule override on this date." }, { status: 409 });
    }

    const prospectiveOverride = {
      id: -claimId,
      workDate: String(openShift.workDate),
      kind: "shift" as const,
      isRestDay: false,
      segments: [{ shiftDefinitionId: shift.id, segmentOrder: 1 }],
      workLocationOrgUnitId: null,
      worksiteId: openShift.worksiteId,
      status: "approved" as const,
      reason: `Open shift #${openShift.id}: ${claim.reason}`,
    };
    const guardrailPolicy = await loadGuardrailPolicy(organizationId);
    const window = await resolveEmployeeScheduleWindow({
      organizationId,
      employeeId: employee.id,
      startDate: addDays(String(openShift.workDate), -7),
      endDate: addDays(String(openShift.workDate), 7),
      prospectiveOverride,
    });
    const guardrailIssues = evaluateScheduleGuardrails({
      days: window,
      policy: guardrailPolicy,
    }).filter((issue) =>
      issue.date === String(openShift.workDate)
      || issue.relatedDate === String(openShift.workDate),
    );
    if (scheduleGuardrailBlocksMutation(guardrailIssues)) {
      return Response.json({
        error: "Open shift approval violates blocking schedule guardrails.",
        guardrailIssues,
      }, { status: 409 });
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from open_shifts where id = ${openShift.id} for update`);
      const approved = await tx.select({ id: openShiftClaims.id }).from(openShiftClaims).where(and(
        eq(openShiftClaims.openShiftId, openShift.id),
        eq(openShiftClaims.status, "approved"),
      ));
      if (approved.length >= openShift.slots) {
        throw new Error("Open shift is already fully claimed.");
      }

      const [updatedClaim] = await tx.update(openShiftClaims).set({
        status: "approved",
        decidedBy: user.name,
        decidedByUserId: user.id,
        decidedAt: new Date(),
        decisionNote,
        updatedAt: new Date(),
      }).where(eq(openShiftClaims.id, claimId)).returning();

      const [override] = await tx.insert(scheduleOverrides).values({
        organizationId,
        employeeId: employee.id,
        workDate: openShift.workDate,
        kind: "shift",
        isRestDay: false,
        segments: prospectiveOverride.segments,
        workLocationOrgUnitId: null,
        worksiteId: openShift.worksiteId,
        reason: prospectiveOverride.reason,
        status: "approved",
        createdBy: user.name,
        approvedBy: user.name,
        approvedAt: new Date(),
      }).returning();

      const filled = approved.length + 1 >= openShift.slots;
      if (filled) {
        await tx.update(openShifts).set({
          status: "filled",
          updatedAt: new Date(),
        }).where(eq(openShifts.id, openShift.id));
      }

      return { updatedClaim, override, filled };
    }).catch((error) => {
      if (error instanceof Error && error.message === "Open shift is already fully claimed.") {
        return null;
      }
      throw error;
    });

    if (!result) return Response.json({ error: "Open shift is already fully claimed." }, { status: 409 });

    const staleTimesheets = await markTimesheetsStaleForEmployeeDate({
      organizationId,
      employeeId: employee.id,
      workDate: String(openShift.workDate),
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "WFM open shift claim approved",
      resource: `${employee.employeeNo} · ${openShift.workDate} · ${shift.code}`,
      metadata: {
        claimId,
        openShiftId: openShift.id,
        employeeId: employee.id,
        scheduleOverrideId: result.override.id,
        filled: result.filled,
        guardrailIssues,
        staleTimesheetIds: staleTimesheets.map((row) => row.id),
      },
    });

    return Response.json({
      claim: result.updatedClaim,
      scheduleOverride: result.override,
      openShiftFilled: result.filled,
      guardrailIssues,
      staleTimesheetIds: staleTimesheets.map((row) => row.id),
    });
  }

  return Response.json({
    error: "Unsupported action. Use create_availability, create_requirement, create_open_shift, claim_open_shift, or decide_claim.",
  }, { status: 400 });
}
