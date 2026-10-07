import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeAvailabilityRules,
  employeePayProfiles,
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  employees,
  jobProfiles,
  leaveRequestIntervals,
  leaveRequestIntervalSets,
  leaveRequests,
  openShiftClaims,
  openShifts,
  positionAssignments,
  positions,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  staffingRequirements,
  timePunches,
  workforceScheduleGuardrailPolicies,
  worksites,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_PAYROLL_ROLES,
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
  rankCoverageCandidates,
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
  type ResolvedDailySchedule,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { matchPunchesToWorkforceSegments } from "@/lib/workforce-payroll";
import { hourlyBaseRate } from "@/lib/workforce-forecast";
import {
  actualWorkedMinutes,
  computeWorkforceLaborVariance,
  paidShiftMinutes,
  type ActualLaborEntry,
} from "@/lib/workforce-labor-variance";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import { assertUnambiguousRoleDemand, resolveEmployeeJobProfileAtDate } from "@/lib/workforce-role-demand";
import { evaluateEmployeeFromCapabilityData, loadCapabilityEligibilityData, loadEmployeeWfmEligibility } from "@/lib/hcm-workforce-eligibility-server";
import { approvedLeaveCoverageImpact } from "@/lib/workforce-absence";
import { resolveLeaveIntervalsForSchedule, type PreciseLeaveInterval } from "@/lib/workforce-absence-intervals";
import { loadSiteEligibilityEvidence, employeeSiteEligibility } from "@/lib/hcm-worksite-eligibility-server";
import { evaluateSiteEligibility } from "@/lib/hcm-worksite-eligibility";

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

async function employeeJobProfileOnDate(
  organizationId: number,
  employeeId: number,
  date: string,
) {
  const assignments = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, organizationId),
    eq(positionAssignments.employeeId, employeeId),
    lte(positionAssignments.effectiveFrom, date),
    or(
      isNull(positionAssignments.effectiveUntil),
      gte(positionAssignments.effectiveUntil, date),
    ),
  )).orderBy(asc(positionAssignments.effectiveFrom), asc(positionAssignments.id));

  const positionIds = [...new Set(assignments.map((row) => row.positionId))];
  const rolePositions = positionIds.length
    ? await db.select({
        id: positions.id,
        jobProfileId: positions.jobProfileId,
      }).from(positions).where(and(
        eq(positions.organizationId, organizationId),
        inArray(positions.id, positionIds),
      ))
    : [];

  return resolveEmployeeJobProfileAtDate({
    employeeId,
    date,
    assignments: assignments.map((row) => ({
      employeeId: row.employeeId,
      positionId: row.positionId,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    })),
    positions: rolePositions,
  });
}

async function approvedLeaveOnDate(
  organizationId: number,
  employeeId: number,
  workDate: string,
) {
  const rows = await db.select().from(leaveRequests).where(and(
    eq(leaveRequests.organizationId, organizationId),
    eq(leaveRequests.employeeId, employeeId),
    eq(leaveRequests.status, "Approved"),
    lte(leaveRequests.startDate, workDate),
    gte(leaveRequests.endDate, workDate),
  )).orderBy(asc(leaveRequests.startDate), asc(leaveRequests.id));

  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    startDate: String(row.startDate),
    endDate: String(row.endDate),
    days: Number(row.days),
    leaveType: row.leaveType,
  }));
}

async function loadCurrentPreciseLeaveEvidence(
  organizationId: number,
  leaveIds: number[],
) {
  const uniqueLeaveIds = [...new Set(leaveIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!uniqueLeaveIds.length) {
    return {
      setByLeaveId: new Map<number, typeof leaveRequestIntervalSets.$inferSelect>(),
      intervalsByLeaveId: new Map<number, Array<typeof leaveRequestIntervals.$inferSelect>>(),
    };
  }

  const sets = await db.select().from(leaveRequestIntervalSets).where(and(
    eq(leaveRequestIntervalSets.organizationId, organizationId),
    eq(leaveRequestIntervalSets.status, "current"),
    inArray(leaveRequestIntervalSets.leaveRequestId, uniqueLeaveIds),
  ));
  const setIds = sets.map((row) => row.id);
  const intervals = setIds.length
    ? await db.select().from(leaveRequestIntervals).where(and(
        eq(leaveRequestIntervals.organizationId, organizationId),
        inArray(leaveRequestIntervals.intervalSetId, setIds),
      ))
    : [];

  const setByLeaveId = new Map(sets.map((row) => [row.leaveRequestId, row]));
  const intervalsByLeaveId = new Map<number, Array<typeof leaveRequestIntervals.$inferSelect>>();
  for (const set of sets) {
    intervalsByLeaveId.set(
      set.leaveRequestId,
      intervals.filter((row) => row.intervalSetId === set.id),
    );
  }
  return { setByLeaveId, intervalsByLeaveId };
}

function preciseInterval(row: typeof leaveRequestIntervals.$inferSelect): PreciseLeaveInterval {
  return {
    workDate: String(row.workDate),
    kind: row.kind as PreciseLeaveInterval["kind"],
    startLocalTime: row.startLocalTime,
    endLocalTime: row.endLocalTime,
    endsNextDay: row.endsNextDay,
    timezone: row.timezone,
  };
}

function shiftWallMinutes(shift: {
  startTime: string;
  endTime: string;
  spansMidnight: boolean;
}) {
  const start = Number(shift.startTime.slice(0, 2)) * 60 + Number(shift.startTime.slice(3, 5));
  let end = Number(shift.endTime.slice(0, 2)) * 60 + Number(shift.endTime.slice(3, 5));
  if (shift.spansMidnight || end <= start) end += 1440;
  return Math.max(0, end - start);
}

async function approvedLeaveConflictForShift(input: {
  organizationId: number;
  employeeId: number;
  workDate: string;
  shift: typeof shiftDefinitions.$inferSelect;
}) {
  const approvedLeave = await approvedLeaveOnDate(
    input.organizationId,
    input.employeeId,
    input.workDate,
  );
  if (!approvedLeave.length) {
    return {
      conflict: false,
      legacyAmbiguous: false,
      unavailableWallMinutes: 0,
      approvedLeave,
    };
  }

  const precise = await loadCurrentPreciseLeaveEvidence(
    input.organizationId,
    approvedLeave.map((row) => row.id),
  );
  let unavailableWallMinutes = 0;
  let legacyAmbiguous = false;

  for (const leave of approvedLeave) {
    const preciseRows = precise.intervalsByLeaveId.get(leave.id) ?? [];
    if (preciseRows.length > 0) {
      const impact = resolveLeaveIntervalsForSchedule({
        workDate: input.workDate,
        intervals: preciseRows.map(preciseInterval).filter((row) => row.workDate === input.workDate),
        schedule: {
          date: input.workDate,
          source: "unassigned",
          isRestDay: false,
          assignmentId: null,
          patternId: null,
          patternDayIndex: null,
          overrideId: null,
          workLocationOrgUnitId: null,
          worksiteId: null,
          audit: [],
          segments: [{
            shiftDefinitionId: input.shift.id,
            shiftCode: input.shift.code,
            shiftName: input.shift.name,
            segmentOrder: 1,
            startTime: input.shift.startTime,
            endTime: input.shift.endTime,
            breakMinutes: input.shift.breakMinutes,
            spansMidnight: input.shift.spansMidnight,
          }],
        },
      });
      unavailableWallMinutes += impact.unavailableWallMinutes;
      continue;
    }

    const legacyImpact = approvedLeaveCoverageImpact(leave);
    if (legacyImpact.kind === "full_day") {
      unavailableWallMinutes += shiftWallMinutes(input.shift);
    } else {
      legacyAmbiguous = true;
    }
  }

  return {
    conflict: unavailableWallMinutes > 0 || legacyAmbiguous,
    legacyAmbiguous,
    unavailableWallMinutes,
    approvedLeave,
  };
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
  const roleByEmployeeDate = new Map<string, number | null>();
  const roleEvidenceIssues = new Set<string>();

  if (input.employeeIds.length === 0) {
    return {
      coverage: [],
      scheduledSegments: [] as Array<{
        employeeId: number;
        workDate: string;
        worksiteId: number | null;
        shiftDefinitionId: number;
        jobProfileId: number | null;
        paidMinutes: number;
      }>,
      schedules: new Map<string, ResolvedDailySchedule>(),
      roleByEmployeeDate,
      roleEvidenceIssues: [] as string[],
      capabilityEvidenceIssues: [] as string[],
      absenceEvidenceIssues: [] as string[],
      siteEvidenceIssues: [] as string[],
    };
  }

  const data = await scheduleCatalog(input.organizationId);
  const [assignmentRows, overrideRows, worksiteRows, roleAssignmentRows, rolePositionRows, approvedLeaveRows] = await Promise.all([
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
    db.select().from(positionAssignments).where(and(
      eq(positionAssignments.organizationId, input.organizationId),
      inArray(positionAssignments.employeeId, input.employeeIds),
      lte(positionAssignments.effectiveFrom, input.endDate),
      or(
        isNull(positionAssignments.effectiveUntil),
        gte(positionAssignments.effectiveUntil, input.startDate),
      ),
    )).orderBy(
      asc(positionAssignments.employeeId),
      asc(positionAssignments.effectiveFrom),
      asc(positionAssignments.id),
    ),
    db.select({
      id: positions.id,
      jobProfileId: positions.jobProfileId,
    }).from(positions)
      .where(eq(positions.organizationId, input.organizationId))
      .orderBy(asc(positions.id)),
    db.select().from(leaveRequests).where(and(
      eq(leaveRequests.organizationId, input.organizationId),
      inArray(leaveRequests.employeeId, input.employeeIds),
      eq(leaveRequests.status, "Approved"),
      lte(leaveRequests.startDate, input.endDate),
      gte(leaveRequests.endDate, input.startDate),
    )).orderBy(asc(leaveRequests.employeeId), asc(leaveRequests.startDate), asc(leaveRequests.id)),
  ]);

  const preciseLeaveEvidence = await loadCurrentPreciseLeaveEvidence(
    input.organizationId,
    approvedLeaveRows.map((row) => row.id),
  );
  const siteEvidence = await loadSiteEligibilityEvidence(input.organizationId, input.employeeIds);
  const siteEvidenceIssues = new Set<string>();
  const capabilityData = await loadCapabilityEligibilityData({
    organizationId: input.organizationId,
    employeeIds: input.employeeIds,
    jobProfileIds: [...new Set(rolePositionRows.map((row) => row.jobProfileId))],
  });
  const capabilityEvidenceIssues = new Set<string>();
  const absenceEvidenceIssues = new Set<string>();

  const shiftsById = new Map(data.shifts.map((shift) => [shift.id, shift]));
  const dates = datesBetween(input.startDate, input.endDate);
  const scheduled = [];
  const scheduledSegments: Array<{
    employeeId: number;
    workDate: string;
    worksiteId: number | null;
    shiftDefinitionId: number;
    jobProfileId: number | null;
    paidMinutes: number;
  }> = [];
  const schedules = new Map<string, ResolvedDailySchedule>();
  const roleAssignments = roleAssignmentRows.map((row) => ({
    employeeId: row.employeeId,
    positionId: row.positionId,
    effectiveFrom: String(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
  }));

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
    const employeeApprovedLeaves = approvedLeaveRows
      .filter((row) => row.employeeId === employeeId)
      .map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        startDate: String(row.startDate),
        endDate: String(row.endDate),
        days: Number(row.days),
        leaveType: row.leaveType,
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
      const role = resolveEmployeeJobProfileAtDate({
        employeeId,
        date,
        assignments: roleAssignments,
        positions: rolePositionRows,
      });
      const roleKey = `${employeeId}|${date}`;
      roleByEmployeeDate.set(roleKey, role.jobProfileId);
      if (role.ambiguous) {
        roleEvidenceIssues.add(
          `Employee #${employeeId} has multiple active job profiles on ${date}; role-specific coverage does not count this worker until position evidence is resolved.`,
        );
      }

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

      schedules.set(roleKey, day);
      for (const segment of day.segments) {
        const shift = shiftsById.get(segment.shiftDefinitionId);
        if (!shift) continue;
        scheduledSegments.push({
          employeeId,
          workDate: date,
          worksiteId: day.worksiteId,
          shiftDefinitionId: segment.shiftDefinitionId,
          jobProfileId: role.jobProfileId,
          paidMinutes: paidShiftMinutes({
            id: shift.id,
            startTime: shift.startTime,
            endTime: shift.endTime,
            breakMinutes: shift.breakMinutes,
            spansMidnight: shift.spansMidnight,
          }),
        });
      }

      const shiftIds = day.segments.map((segment) => segment.shiftDefinitionId);
      const unavailableShiftIds = shiftIds.filter((shiftId) => {
        const shift = shiftsById.get(shiftId);
        return shift ? availabilityConflictForShift({ rules: availability, date, shift }) : false;
      });
      const capabilityEligibility = role.jobProfileId == null
        ? null
        : evaluateEmployeeFromCapabilityData({
            data: capabilityData,
            employeeId,
            jobProfileId: role.jobProfileId,
            workDate: date,
          });
      const capabilityIneligibleShiftIds = capabilityEligibility && !capabilityEligibility.eligible
        ? shiftIds
        : [];
      if (capabilityEligibility && !capabilityEligibility.eligible) {
        capabilityEvidenceIssues.add(
          "Employee #" + employeeId + " is not qualified for job profile #" + role.jobProfileId
          + " on " + date + ": " + capabilityEligibility.blockers.join(" "),
        );
      }
      const paidMinutesByShiftDefinitionId: Record<number, number> = {};
      for (const segment of day.segments) {
        const paid = Math.max(0, Number(segment.endTime ? (
          (() => {
            const shift = shiftsById.get(segment.shiftDefinitionId);
            return shift ? paidShiftMinutes({
              id: shift.id,
              startTime: shift.startTime,
              endTime: shift.endTime,
              breakMinutes: shift.breakMinutes,
              spansMidnight: shift.spansMidnight,
            }) : 0;
          })()
        ) : 0));
        paidMinutesByShiftDefinitionId[segment.shiftDefinitionId] =
          (paidMinutesByShiftDefinitionId[segment.shiftDefinitionId] ?? 0) + paid;
      }

      const approvedLeaveUnavailableMinutesByShiftDefinitionId: Record<number, number> = {};
      const fullUnavailableShiftIds = new Set<number>();
      const dayApprovedLeaves = employeeApprovedLeaves.filter(
        (leave) => leave.startDate <= date && leave.endDate >= date,
      );

      for (const leave of dayApprovedLeaves) {
        const preciseRows = preciseLeaveEvidence.intervalsByLeaveId.get(leave.id) ?? [];
        if (preciseRows.length > 0) {
          const impact = resolveLeaveIntervalsForSchedule({
            workDate: date,
            intervals: preciseRows.map(preciseInterval).filter((row) => row.workDate === date),
            schedule: day,
          });
          for (const blocker of impact.blockers) {
            absenceEvidenceIssues.add(
              "Employee #" + employeeId + " · " + date + " · " + blocker.code + ": " + blocker.message,
            );
          }
          for (const warning of impact.warnings) {
            absenceEvidenceIssues.add(
              "Employee #" + employeeId + " · " + date + " · " + warning.code + ": " + warning.message,
            );
          }
          for (const segmentImpact of impact.segmentImpacts) {
            const segment = day.segments.find((row) => row.segmentOrder === segmentImpact.segmentOrder);
            if (!segment || segmentImpact.unavailablePaidMinutes == null) continue;
            const shiftId = segment.shiftDefinitionId;
            approvedLeaveUnavailableMinutesByShiftDefinitionId[shiftId] =
              (approvedLeaveUnavailableMinutesByShiftDefinitionId[shiftId] ?? 0)
              + segmentImpact.unavailablePaidMinutes;
          }
          continue;
        }

        const legacyImpact = approvedLeaveCoverageImpact(leave);
        if (legacyImpact.kind === "full_day") {
          for (const shiftId of shiftIds) {
            fullUnavailableShiftIds.add(shiftId);
            approvedLeaveUnavailableMinutesByShiftDefinitionId[shiftId] =
              paidMinutesByShiftDefinitionId[shiftId] ?? 0;
          }
        } else {
          absenceEvidenceIssues.add(
            "Employee #" + employeeId + " has approved partial/ambiguous leave on " + date
            + "; Legacy timing is ambiguous and exact shift-hour impact is not guessed.",
          );
        }
      }

      for (const shiftId of shiftIds) {
        const paid = paidMinutesByShiftDefinitionId[shiftId] ?? 0;
        const unavailable = approvedLeaveUnavailableMinutesByShiftDefinitionId[shiftId] ?? 0;
        if (paid > 0 && unavailable >= paid) fullUnavailableShiftIds.add(shiftId);
      }
      const approvedLeaveShiftDefinitionIds = [...fullUnavailableShiftIds];
      const siteEligibility = evaluateSiteEligibility({
        ...siteEvidence,
        employeeId,
        date,
        worksiteId: day.worksiteId,
      });
      const siteIneligibleShiftDefinitionIds = siteEligibility.eligible ? [] : shiftIds;
      if (siteEligibility.blockers.length) {
        siteEvidenceIssues.add("Employee #" + employeeId + " · " + date + ": " + siteEligibility.blockers.join(" "));
      }
      if (siteEligibility.warnings.length) {
        siteEvidenceIssues.add("Employee #" + employeeId + " · " + date + ": " + siteEligibility.warnings.join(" "));
      }

      scheduled.push({
        employeeId,
        workDate: date,
        worksiteId: day.worksiteId,
        jobProfileId: role.jobProfileId,
        shiftDefinitionIds: shiftIds,
        unavailableShiftDefinitionIds: unavailableShiftIds,
        ineligibleShiftDefinitionIds: capabilityIneligibleShiftIds,
        approvedLeaveShiftDefinitionIds,
        approvedLeaveUnavailableMinutesByShiftDefinitionId,
        paidMinutesByShiftDefinitionId,
        siteIneligibleShiftDefinitionIds,
      });
    }
  }

  return {
    coverage: computeCoverage({
      requirements: input.requirements.map((row) => ({
        id: row.id,
        worksiteId: row.worksiteId,
        workDate: String(row.workDate),
        shiftDefinitionId: row.shiftDefinitionId,
        jobProfileId: row.jobProfileId,
        requiredHeadcount: row.requiredHeadcount,
      })),
      scheduled,
    }),
    scheduledSegments,
    schedules,
    roleByEmployeeDate,
    roleEvidenceIssues: [...roleEvidenceIssues],
    capabilityEvidenceIssues: [...capabilityEvidenceIssues],
    absenceEvidenceIssues: [...absenceEvidenceIssues],
    siteEvidenceIssues: [...siteEvidenceIssues],
  };
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

  const costDenied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "People/payroll access is required to view labor-cost variance.",
  );
  const canViewLaborCosts = costDenied === null;

  const employeeIds = workforce.visibleEmployees.map((employee) => employee.id);
  const worksiteIds = workforce.visibleWorksites.map((site) => site.id);

  const [requirements, availability, openShiftRows, claimRows, shifts, punchRows, payProfileRows] = await Promise.all([
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
    employeeIds.length
      ? db.select().from(timePunches).where(and(
          eq(timePunches.organizationId, organizationId),
          inArray(timePunches.employeeId, employeeIds),
          gte(timePunches.workDate, startDate),
          lte(timePunches.workDate, endDate),
        )).orderBy(asc(timePunches.employeeId), asc(timePunches.workDate), asc(timePunches.id))
      : [],
    canViewLaborCosts && employeeIds.length
      ? db.select().from(employeePayProfiles).where(and(
          eq(employeePayProfiles.organizationId, organizationId),
          inArray(employeePayProfiles.employeeId, employeeIds),
        )).orderBy(asc(employeePayProfiles.employeeId))
      : [],
  ]);

  const profileRows = await db.select().from(jobProfiles)
    .where(and(
      eq(jobProfiles.organizationId, organizationId),
      eq(jobProfiles.active, true),
    ))
    .orderBy(asc(jobProfiles.family), asc(jobProfiles.title), asc(jobProfiles.level));

  try {
    assertUnambiguousRoleDemand(requirements.map((row) => ({
      worksiteId: row.worksiteId,
      workDate: String(row.workDate),
      shiftDefinitionId: row.shiftDefinitionId,
      jobProfileId: row.jobProfileId,
    })));
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Staffing demand is ambiguous.",
    }, { status: 409 });
  }

  const coverageData = await coverageRows({
    organizationId,
    employeeIds,
    startDate,
    endDate,
    requirements,
    availabilityRows: availability,
  });

  const hourlyRateByEmployee = new Map<number, number>();
  const invalidPayProfileEmployeeIds: number[] = [];
  if (canViewLaborCosts) {
    for (const profile of payProfileRows) {
      try {
        hourlyRateByEmployee.set(profile.employeeId, hourlyBaseRate({
          employeeId: profile.employeeId,
          payBasis: profile.payBasis,
          rateAmount: profile.rateAmount,
          standardWorkDaysPerMonth: profile.standardWorkDaysPerMonth,
          standardHoursPerDay: profile.standardHoursPerDay,
        }));
      } catch {
        invalidPayProfileEmployeeIds.push(profile.employeeId);
      }
    }
  }
  const missingPayProfileEmployeeIds = canViewLaborCosts
    ? employeeIds.filter((employeeId) => !hourlyRateByEmployee.has(employeeId))
    : [];
  const validRates = [...hourlyRateByEmployee.values()];
  const benchmarkHourlyRate = validRates.length
    ? validRates.reduce((sum, rate) => sum + rate, 0) / validRates.length
    : 0;

  const scheduledLabor = coverageData.scheduledSegments.map((entry) => ({
    ...entry,
    hourlyRate: hourlyRateByEmployee.get(entry.employeeId) ?? 0,
  }));

  const punchesByEmployeeDate = new Map<string, typeof punchRows>();
  for (const punch of punchRows) {
    const key = `${punch.employeeId}|${String(punch.workDate)}`;
    punchesByEmployeeDate.set(key, [...(punchesByEmployeeDate.get(key) ?? []), punch]);
  }

  const actualLabor: ActualLaborEntry[] = [];
  for (const [key, datePunches] of punchesByEmployeeDate) {
    const [employeeIdText, workDate] = key.split("|");
    const employeeId = Number(employeeIdText);
    const schedule = coverageData.schedules.get(key);
    const resolution = matchPunchesToWorkforceSegments({
      date: workDate,
      schedule,
      punches: datePunches.map((punch) => ({
        id: punch.id,
        timeIn: punch.timeIn,
      })),
    });

    for (const punch of datePunches) {
      const segment = resolution.segmentByPunchId.get(punch.id) ?? null;
      const worked = actualWorkedMinutes({
        timeIn: punch.timeIn,
        timeOut: punch.timeOut,
        breakStart: punch.breakStart,
        breakEnd: punch.breakEnd,
        scheduledBreakMinutes: segment?.breakMinutes ?? 60,
      });
      actualLabor.push({
        employeeId,
        workDate,
        worksiteId: schedule?.worksiteId ?? null,
        shiftDefinitionId: segment?.shiftDefinitionId ?? null,
        jobProfileId: coverageData.roleByEmployeeDate.get(key) ?? null,
        workedMinutes: worked.minutes,
        hourlyRate: hourlyRateByEmployee.get(employeeId) ?? 0,
        matchedToSchedule: Boolean(segment) && !resolution.exception,
        flags: [
          ...worked.flags,
          ...(resolution.exception ? [resolution.exception] : []),
        ],
      });
    }
  }

  const laborVariance = computeWorkforceLaborVariance({
    requirements: requirements.map((row) => ({
      id: row.id,
      worksiteId: row.worksiteId,
      workDate: String(row.workDate),
      shiftDefinitionId: row.shiftDefinitionId,
      jobProfileId: row.jobProfileId,
      requiredHeadcount: row.requiredHeadcount,
    })),
    shifts: shifts.map((shift) => ({
      id: shift.id,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes,
      spansMidnight: shift.spansMidnight,
    })),
    scheduled: scheduledLabor,
    actual: actualLabor,
    benchmarkHourlyRate,
  });

  const laborVarianceResponse = {
    ...laborVariance,
    costVisible: canViewLaborCosts,
    rows: laborVariance.rows.map((row) => canViewLaborCosts ? row : {
      ...row,
      benchmarkHourlyRate: null,
      requiredCostBasis: null,
      requiredBaseCost: null,
      scheduledBaseCost: null,
      actualBaseCost: null,
      scheduledVsRequiredBaseCost: null,
      actualVsScheduledBaseCost: null,
      actualVsRequiredBaseCost: null,
    }),
    summary: canViewLaborCosts ? laborVariance.summary : {
      ...laborVariance.summary,
      requiredBaseCost: null,
      scheduledBaseCost: null,
      actualBaseCost: null,
      scheduledVsRequiredBaseCost: null,
      actualVsScheduledBaseCost: null,
      actualVsRequiredBaseCost: null,
      unmatchedActualBaseCost: null,
      scheduledOutsideRequirementBaseCost: null,
    },
    quality: {
      missingPayProfileEmployeeIds,
      invalidPayProfileEmployeeIds,
      unmatchedPunchRows: actualLabor.filter((entry) => !entry.matchedToSchedule).length,
      roleEvidenceIssues: coverageData.roleEvidenceIssues,
      capabilityEvidenceIssues: coverageData.capabilityEvidenceIssues,
      absenceEvidenceIssues: coverageData.absenceEvidenceIssues,
      siteEvidenceIssues: coverageData.siteEvidenceIssues,
    },
  };

  const employeeNameById = new Map(
    workforce.visibleEmployees.map((employee) => [
      employee.id,
      `${employee.firstName} ${employee.lastName}`,
    ]),
  );
  const scheduledMinutesByEmployee = new Map<number, number>();
  for (const segment of coverageData.scheduledSegments) {
    scheduledMinutesByEmployee.set(
      segment.employeeId,
      (scheduledMinutesByEmployee.get(segment.employeeId) ?? 0) + segment.paidMinutes,
    );
  }

  const claimRecommendations = openShiftRows.map((openShift) => {
    const shift = shifts.find((row) => row.id === openShift.shiftDefinitionId);
    if (!shift) {
      return { openShiftId: openShift.id, recommendations: [] };
    }
    const pending = claimRows.filter((claim) =>
      claim.openShiftId === openShift.id
      && claim.status === "pending"
      && employeeIds.includes(claim.employeeId),
    );
    const claimIdByEmployee = new Map(pending.map((claim) => [claim.employeeId, claim.id]));
    const ranked = rankCoverageCandidates({
      shiftPaidMinutes: paidShiftMinutes({
        id: shift.id,
        startTime: shift.startTime,
        endTime: shift.endTime,
        breakMinutes: shift.breakMinutes,
        spansMidnight: shift.spansMidnight,
      }),
      candidates: pending.map((claim) => {
        const rules: AvailabilityRule[] = availability
          .filter((row) => row.employeeId === claim.employeeId)
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
        let consecutiveWorkingDaysBeforeShift = 0;
        for (let offset = 1; offset <= 7; offset += 1) {
          const previousDate = addDays(String(openShift.workDate), -offset);
          const previous = coverageData.schedules.get(`${claim.employeeId}|${previousDate}`);
          if (!previous || previous.isRestDay || previous.segments.length === 0) break;
          consecutiveWorkingDaysBeforeShift += 1;
        }
        const current = coverageData.schedules.get(
          `${claim.employeeId}|${String(openShift.workDate)}`,
        );
        return {
          employeeId: claim.employeeId,
          employeeName: employeeNameById.get(claim.employeeId) ?? `Employee #${claim.employeeId}`,
          preferred: preferredForShift({
            rules,
            date: String(openShift.workDate),
            shift,
          }),
          scheduledMinutesInWindow: scheduledMinutesByEmployee.get(claim.employeeId) ?? 0,
          consecutiveWorkingDaysBeforeShift,
          alreadyWorkingThatDay: Boolean(
            current && !current.isRestDay && current.segments.length > 0,
          ),
        };
      }),
    });
    return {
      openShiftId: openShift.id,
      recommendations: ranked.map((candidate, index) => ({
        ...candidate,
        rank: index + 1,
        claimId: claimIdByEmployee.get(candidate.employeeId) ?? null,
      })),
    };
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
    jobProfiles: profileRows,
    requirements,
    availability,
    coverage: coverageData.coverage,
    laborVariance: laborVarianceResponse,
    claimRecommendations,
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
    const jobProfileId = body.jobProfileId == null || body.jobProfileId === ""
      ? null
      : Number(body.jobProfileId);
    const workDate = String(body.workDate ?? "");
    const requiredHeadcount = Number(body.requiredHeadcount);
    const notes = String(body.notes ?? "").trim().slice(0, 240) || null;

    if (!Number.isInteger(worksiteId) || !Number.isInteger(shiftDefinitionId) || !ISO_DATE.test(workDate)
      || !Number.isInteger(requiredHeadcount) || requiredHeadcount < 1 || requiredHeadcount > 10000
      || (jobProfileId != null && (!Number.isInteger(jobProfileId) || jobProfileId <= 0))) {
      return Response.json({ error: "worksiteId, shiftDefinitionId, optional jobProfileId, workDate and positive requiredHeadcount are required." }, { status: 400 });
    }

    const [site, shift, profile] = await Promise.all([
      db.select().from(worksites).where(and(
        eq(worksites.id, worksiteId),
        eq(worksites.organizationId, organizationId),
      )).limit(1),
      db.select().from(shiftDefinitions).where(and(
        eq(shiftDefinitions.id, shiftDefinitionId),
        eq(shiftDefinitions.organizationId, organizationId),
      )).limit(1),
      jobProfileId == null
        ? Promise.resolve([])
        : db.select().from(jobProfiles).where(and(
            eq(jobProfiles.id, jobProfileId),
            eq(jobProfiles.organizationId, organizationId),
            eq(jobProfiles.active, true),
          )).limit(1),
    ]);
    if (!site[0] || !shift[0]) return Response.json({ error: "Worksite or shift does not belong to this organization." }, { status: 422 });
    if (jobProfileId != null && !profile[0]) return Response.json({ error: "Job profile does not belong to this organization or is inactive." }, { status: 422 });
    const scope = assertScope(access, site[0].orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const siblingRequirements = await db.select().from(staffingRequirements).where(and(
      eq(staffingRequirements.organizationId, organizationId),
      eq(staffingRequirements.worksiteId, worksiteId),
      eq(staffingRequirements.workDate, workDate),
      eq(staffingRequirements.shiftDefinitionId, shiftDefinitionId),
    ));
    if (jobProfileId == null && siblingRequirements.some((row) => row.jobProfileId != null)) {
      return Response.json({
        error: "This worksite/date/shift already uses role-specific demand. Remove those rows before creating an Any job profile requirement.",
      }, { status: 409 });
    }
    if (jobProfileId != null && siblingRequirements.some((row) => row.jobProfileId == null)) {
      return Response.json({
        error: "This worksite/date/shift already uses an Any job profile requirement. Replace it before splitting demand by role.",
      }, { status: 409 });
    }
    const existing = siblingRequirements.find((row) => row.jobProfileId === jobProfileId) ?? null;

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
          jobProfileId,
          requiredHeadcount,
          notes,
          createdBy: user.name,
          createdByUserId: user.id,
        }).returning();

    const roleLabel = profile[0] ? `${profile[0].title} · ${profile[0].level}` : "Any job profile";
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: existing ? "WFM staffing requirement updated" : "WFM staffing requirement created",
      resource: `${site[0].code} · ${workDate} · ${shift[0].code} · ${roleLabel}`,
      metadata: { requirementId: saved.id, worksiteId, workDate, shiftDefinitionId, jobProfileId, requiredHeadcount },
    });

    return Response.json({ requirement: saved }, { status: existing ? 200 : 201 });
  }

  if (action === "create_open_shift") {
    const worksiteId = Number(body.worksiteId);
    const shiftDefinitionId = Number(body.shiftDefinitionId);
    const workDate = String(body.workDate ?? "");
    const slots = Number(body.slots ?? 1);
    const sourceRequirementId = body.sourceRequirementId == null ? null : Number(body.sourceRequirementId);
    const requestedJobProfileId = body.jobProfileId == null || body.jobProfileId === ""
      ? null
      : Number(body.jobProfileId);
    const reason = String(body.reason ?? "Coverage gap").trim().slice(0, 240);

    if (!Number.isInteger(worksiteId) || !Number.isInteger(shiftDefinitionId) || !ISO_DATE.test(workDate)
      || !Number.isInteger(slots) || slots < 1 || slots > 1000 || !reason
      || (requestedJobProfileId != null && (!Number.isInteger(requestedJobProfileId) || requestedJobProfileId <= 0))) {
      return Response.json({ error: "Valid worksite, shift, optional job profile, date, slots and reason are required." }, { status: 400 });
    }

    const [site, shift] = await Promise.all([
      db.select().from(worksites).where(and(eq(worksites.id, worksiteId), eq(worksites.organizationId, organizationId))).limit(1),
      db.select().from(shiftDefinitions).where(and(eq(shiftDefinitions.id, shiftDefinitionId), eq(shiftDefinitions.organizationId, organizationId))).limit(1),
    ]);
    if (!site[0] || !shift[0]) return Response.json({ error: "Worksite or shift not found." }, { status: 404 });
    const scope = assertScope(access, site[0].orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    let jobProfileId = requestedJobProfileId;
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
      if (requestedJobProfileId != null && requestedJobProfileId !== requirement.jobProfileId) {
        return Response.json({ error: "Open-shift job profile must match its staffing requirement." }, { status: 422 });
      }
      jobProfileId = requirement.jobProfileId;
    }
    if (jobProfileId != null) {
      const [profile] = await db.select().from(jobProfiles).where(and(
        eq(jobProfiles.id, jobProfileId),
        eq(jobProfiles.organizationId, organizationId),
        eq(jobProfiles.active, true),
      )).limit(1);
      if (!profile) {
        return Response.json({ error: "Open-shift job profile is inactive or outside this organization." }, { status: 422 });
      }
    }

    const [created] = await db.insert(openShifts).values({
      organizationId,
      worksiteId,
      workDate,
      shiftDefinitionId,
      jobProfileId,
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
      metadata: { openShiftId: created.id, slots, sourceRequirementId, jobProfileId, reason },
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

    if (shiftRow.jobProfileId != null) {
      const role = await employeeJobProfileOnDate(
        organizationId,
        employeeId,
        String(shiftRow.workDate),
      );
      if (role.ambiguous) {
        return Response.json({
          error: "The employee has ambiguous active position/job-profile evidence for this date.",
        }, { status: 409 });
      }
      if (role.jobProfileId !== shiftRow.jobProfileId) {
        return Response.json({
          error: "The employee does not hold the job profile required by this open shift on the work date.",
        }, { status: 409 });
      }
      const capabilityEligibility = await loadEmployeeWfmEligibility({
        organizationId,
        employeeId,
        jobProfileId: shiftRow.jobProfileId,
        workDate: String(shiftRow.workDate),
      });
      if (!capabilityEligibility.eligible) {
        return Response.json({
          error: "The employee does not meet the required skills or credentials for this open shift.",
          capabilityEligibility,
        }, { status: 409 });
      }
    }

    const siteEligibility = await employeeSiteEligibility({
      organizationId, employeeId, date: String(shiftRow.workDate), worksiteId: shiftRow.worksiteId,
    });
    if (!siteEligibility.eligible) {
      return Response.json({
        error: "Employee lacks effective worksite authorization or compatible work arrangement for this shift.",
        siteEligibility,
      }, { status: 409 });
    }

    const [shiftDefinition] = await db.select().from(shiftDefinitions).where(and(
      eq(shiftDefinitions.id, shiftRow.shiftDefinitionId),
      eq(shiftDefinitions.organizationId, organizationId),
    )).limit(1);
    if (!shiftDefinition) {
      return Response.json({ error: "Shift definition not found." }, { status: 404 });
    }

    const leaveConflict = await approvedLeaveConflictForShift({
      organizationId,
      employeeId,
      workDate: String(shiftRow.workDate),
      shift: shiftDefinition,
    });
    if (leaveConflict.conflict) {
      return Response.json({
        error: leaveConflict.legacyAmbiguous
          ? "Approved leave overlaps this date but Legacy timing is ambiguous. Resolve the absence timing before claiming a full open shift."
          : "Approved leave overlaps this open shift and the employee cannot claim the full shift.",
        unavailableWallMinutes: leaveConflict.unavailableWallMinutes,
        approvedLeave: leaveConflict.approvedLeave,
      }, { status: 409 });
    }
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

    if (openShift.jobProfileId != null) {
      const role = await employeeJobProfileOnDate(
        organizationId,
        employee.id,
        String(openShift.workDate),
      );
      if (role.ambiguous || role.jobProfileId !== openShift.jobProfileId) {
        return Response.json({
          error: "The employee no longer has unambiguous active position evidence for the job profile required by this open shift.",
        }, { status: 409 });
      }
      const capabilityEligibility = await loadEmployeeWfmEligibility({
        organizationId,
        employeeId: employee.id,
        jobProfileId: openShift.jobProfileId,
        workDate: String(openShift.workDate),
      });
      if (!capabilityEligibility.eligible) {
        return Response.json({
          error: "The employee no longer meets the required skills or credentials for this open shift.",
          capabilityEligibility,
        }, { status: 409 });
      }
    }

    const siteEligibility = await employeeSiteEligibility({
      organizationId, employeeId: employee.id, date: String(openShift.workDate), worksiteId: openShift.worksiteId,
    });
    if (!siteEligibility.eligible) {
      return Response.json({
        error: "Worker worksite authorization or work arrangement changed before approval.",
        siteEligibility,
      }, { status: 409 });
    }

    const [shift] = await db.select().from(shiftDefinitions).where(and(
      eq(shiftDefinitions.id, openShift.shiftDefinitionId),
      eq(shiftDefinitions.organizationId, organizationId),
    )).limit(1);
    if (!shift) return Response.json({ error: "Shift definition not found." }, { status: 404 });

    const leaveConflict = await approvedLeaveConflictForShift({
      organizationId,
      employeeId: employee.id,
      workDate: String(openShift.workDate),
      shift,
    });
    if (leaveConflict.conflict) {
      return Response.json({
        error: leaveConflict.legacyAmbiguous
          ? "Approved leave now overlaps this date but Legacy timing is ambiguous. Resolve the absence before approving a full open shift."
          : "Approved leave now overlaps this open shift and the employee cannot be approved for the full shift.",
        unavailableWallMinutes: leaveConflict.unavailableWallMinutes,
        approvedLeave: leaveConflict.approvedLeave,
      }, { status: 409 });
    }

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
        jobProfileId: openShift.jobProfileId,
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
