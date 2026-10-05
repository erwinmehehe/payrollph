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
} from "@/db/schema";
import {
  resolveDailySchedule,
  type WorkforceScheduleAssignment,
  type WorkforceScheduleOverride,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";

function datesBetween(startDate: string, endDate: string) {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  for (
    let cursor = new Date(start);
    cursor <= end && dates.length <= 42;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export async function resolveEmployeeScheduleWindow(input: {
  organizationId: number;
  employeeId: number;
  startDate: string;
  endDate: string;
  prospectiveAssignment?: WorkforceScheduleAssignment | null;
  prospectiveOverride?: WorkforceScheduleOverride | null;
}) {
  const [shifts, patterns, days, segments, assignmentRows, overrideRows, worksiteAssignments] = await Promise.all([
    db.select().from(shiftDefinitions)
      .where(eq(shiftDefinitions.organizationId, input.organizationId))
      .orderBy(asc(shiftDefinitions.code)),
    db.select().from(schedulePatterns)
      .where(eq(schedulePatterns.organizationId, input.organizationId))
      .orderBy(asc(schedulePatterns.code)),
    db.select({
      id: schedulePatternDays.id,
      patternId: schedulePatternDays.patternId,
      dayIndex: schedulePatternDays.dayIndex,
      isRestDay: schedulePatternDays.isRestDay,
      label: schedulePatternDays.label,
    }).from(schedulePatternDays)
      .innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId, input.organizationId))
      .orderBy(asc(schedulePatternDays.patternId), asc(schedulePatternDays.dayIndex)),
    db.select({
      patternDayId: schedulePatternSegments.patternDayId,
      shiftDefinitionId: schedulePatternSegments.shiftDefinitionId,
      segmentOrder: schedulePatternSegments.segmentOrder,
    }).from(schedulePatternSegments)
      .innerJoin(schedulePatternDays, eq(schedulePatternSegments.patternDayId, schedulePatternDays.id))
      .innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId, input.organizationId))
      .orderBy(asc(schedulePatternSegments.patternDayId), asc(schedulePatternSegments.segmentOrder)),
    db.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, input.organizationId),
      eq(employeeScheduleAssignments.employeeId, input.employeeId),
    )).orderBy(asc(employeeScheduleAssignments.effectiveFrom), asc(employeeScheduleAssignments.id)),
    db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, input.organizationId),
      eq(scheduleOverrides.employeeId, input.employeeId),
      gte(scheduleOverrides.workDate, input.startDate),
      lte(scheduleOverrides.workDate, input.endDate),
    )).orderBy(asc(scheduleOverrides.workDate), asc(scheduleOverrides.id)),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, input.organizationId),
      eq(employeeWorksiteAssignments.employeeId, input.employeeId),
    )).orderBy(asc(employeeWorksiteAssignments.effectiveFrom), asc(employeeWorksiteAssignments.id)),
  ]);

  const assignments: WorkforceScheduleAssignment[] = assignmentRows.map((row) => ({
    id: row.id,
    patternId: row.patternId,
    effectiveFrom: String(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    anchorDate: String(row.anchorDate),
    workLocationOrgUnitId: row.workLocationOrgUnitId,
    worksiteId: row.worksiteId,
  }));
  if (input.prospectiveAssignment) assignments.push(input.prospectiveAssignment);

  const overrides: WorkforceScheduleOverride[] = overrideRows.map((row) => ({
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
  if (input.prospectiveOverride) overrides.push(input.prospectiveOverride);

  const defaultWorksites = worksiteAssignments.map((row) => ({
    id: row.id,
    worksiteId: row.worksiteId,
    effectiveFrom: String(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
  }));

  return datesBetween(input.startDate, input.endDate).map((date) =>
    resolveDailySchedule({
      date,
      assignments,
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
      overrides,
      defaultWorksiteId:
        selectEffectiveWorksiteAssignment(defaultWorksites, date)?.worksiteId ?? null,
    }),
  );
}
