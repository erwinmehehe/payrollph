import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  worksites,
} from "@/db/schema";
import {
  resolveDailySchedule,
  type ResolvedDailySchedule,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";

export async function loadResolvedEmployeeSchedule(input: {
  organizationId: number;
  employeeId: number;
  workDate: string;
}): Promise<{ schedule: ResolvedDailySchedule; timezone: string }> {
  const { organizationId, employeeId, workDate } = input;

  const [shifts, patterns, days, segments, assignments, overrides, worksiteAssignments] = await Promise.all([
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
    db.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, organizationId),
      eq(employeeScheduleAssignments.employeeId, employeeId),
    )).orderBy(asc(employeeScheduleAssignments.effectiveFrom), asc(employeeScheduleAssignments.id)),
    db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, organizationId),
      eq(scheduleOverrides.employeeId, employeeId),
      gte(scheduleOverrides.workDate, workDate),
      lte(scheduleOverrides.workDate, workDate),
    )).orderBy(asc(scheduleOverrides.workDate), asc(scheduleOverrides.id)),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, organizationId),
      eq(employeeWorksiteAssignments.employeeId, employeeId),
    )).orderBy(asc(employeeWorksiteAssignments.effectiveFrom), asc(employeeWorksiteAssignments.id)),
  ]);

  const defaultWorksites = worksiteAssignments.map((row) => ({
    id: row.id,
    worksiteId: row.worksiteId,
    effectiveFrom: String(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
  }));

  const schedule = resolveDailySchedule({
    date: workDate,
    assignments: assignments.map((row) => ({
      id: row.id,
      patternId: row.patternId,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      anchorDate: String(row.anchorDate),
      workLocationOrgUnitId: row.workLocationOrgUnitId,
      worksiteId: row.worksiteId,
    })),
    patterns: patterns.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      cycleDays: row.cycleDays,
    })),
    patternDays: days,
    patternSegments: segments,
    shifts: shifts.map((row) => ({
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
    defaultWorksiteId:
      selectEffectiveWorksiteAssignment(defaultWorksites, workDate)?.worksiteId ?? null,
  });

  const [site] = schedule.worksiteId == null
    ? []
    : await db.select({ timezone: worksites.timezone })
      .from(worksites)
      .where(and(eq(worksites.organizationId, organizationId), eq(worksites.id, schedule.worksiteId)))
      .limit(1);

  return { schedule, timezone: site?.timezone ?? "Asia/Manila" };
}
