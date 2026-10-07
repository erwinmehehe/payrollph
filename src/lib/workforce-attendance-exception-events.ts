import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceExceptionEvents,
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  overtimeRequests,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  timePunches,
} from "@/db/schema";
import { runAutomationEventSafely } from "@/lib/automation";
import { analyzeAttendanceDay, type AttendanceException } from "@/lib/workforce-attendance";
import {
  resolveDailySchedule,
  type WorkforceScheduleOverrideSegment,
} from "@/lib/workforce-scheduling";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import type {
  OvertimeRequestKind,
  OvertimeRequestStatus,
} from "@/lib/workforce-overtime";
import { attendanceExceptionSlaDueAt } from "@/lib/workforce-attendance-exception-governance";

export function attendanceExceptionFingerprint(input: {
  workDate: string;
  exception: AttendanceException;
}) {
  const row = [
    input.workDate,
    input.exception.kind,
    input.exception.severity,
    input.exception.punchId ?? "",
    input.exception.minutes ?? "",
    input.exception.message,
  ].join("|");
  return createHash("sha256").update(row).digest("hex");
}

export async function reconcileAttendanceExceptionEvents(input: {
  organizationId: number;
  employeeId: number;
  workDate: string;
}) {
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
  ] = await Promise.all([
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
      id: schedulePatternSegments.id,
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
    )).orderBy(
      asc(employeeScheduleAssignments.effectiveFrom),
      asc(employeeScheduleAssignments.id),
    ),
    db.select().from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, input.organizationId),
      eq(scheduleOverrides.employeeId, input.employeeId),
      eq(scheduleOverrides.workDate, input.workDate),
    )).orderBy(asc(scheduleOverrides.id)),
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, input.organizationId),
      eq(employeeWorksiteAssignments.employeeId, input.employeeId),
    )).orderBy(
      asc(employeeWorksiteAssignments.effectiveFrom),
      asc(employeeWorksiteAssignments.id),
    ),
    db.select().from(timePunches).where(and(
      eq(timePunches.organizationId, input.organizationId),
      eq(timePunches.employeeId, input.employeeId),
      eq(timePunches.workDate, input.workDate),
    )).orderBy(asc(timePunches.id)),
    db.select().from(overtimeRequests).where(and(
      eq(overtimeRequests.organizationId, input.organizationId),
      eq(overtimeRequests.employeeId, input.employeeId),
      eq(overtimeRequests.workDate, input.workDate),
    )).orderBy(asc(overtimeRequests.id)),
  ]);

  const schedule = resolveDailySchedule({
    date: input.workDate,
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
      selectEffectiveWorksiteAssignment(
        worksiteAssignments.map((row) => ({
          id: row.id,
          worksiteId: row.worksiteId,
          effectiveFrom: String(row.effectiveFrom),
          effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        })),
        input.workDate,
      )?.worksiteId ?? null,
  });

  const analysis = analyzeAttendanceDay({
    date: input.workDate,
    schedule,
    punches: punches.map((punch) => ({
      id: punch.id,
      timeIn: punch.timeIn,
      timeOut: punch.timeOut,
      breakStart: punch.breakStart,
      breakEnd: punch.breakEnd,
      shiftStart: punch.shiftStart,
      shiftEnd: punch.shiftEnd,
    })),
    overtimeRequests: overtimeRows.map((ot) => ({
      id: ot.id,
      status: ot.status as OvertimeRequestStatus,
      requestKind: ot.requestKind as OvertimeRequestKind,
      requestedMinutes: ot.requestedMinutes,
      requestedByUserId: ot.requestedByUserId,
      decidedByUserId: ot.decidedByUserId,
    })),
  });

  const now = new Date();
  const current = analysis.exceptions.map((exception) => ({
    exception,
    fingerprint: attendanceExceptionFingerprint({ workDate: input.workDate, exception }),
  }));
  const currentFingerprints = new Set(current.map((row) => row.fingerprint));

  const existing = await db.select().from(attendanceExceptionEvents).where(and(
    eq(attendanceExceptionEvents.organizationId, input.organizationId),
    eq(attendanceExceptionEvents.employeeId, input.employeeId),
    eq(attendanceExceptionEvents.workDate, input.workDate),
  ));

  const existingByFingerprint = new Map(existing.map((row) => [row.fingerprintSha256, row]));
  const created = [];

  for (const item of current) {
    const found = existingByFingerprint.get(item.fingerprint);
    if (found) {
      await db.update(attendanceExceptionEvents).set({
        severity: item.exception.severity,
        punchId: item.exception.punchId ?? null,
        minutes: item.exception.minutes ?? null,
        message: item.exception.message,
        status: "open",
        slaDueAt: found.slaDueAt ?? attendanceExceptionSlaDueAt({
          firstDetectedAt: found.firstDetectedAt,
          severity: item.exception.severity,
        }),
        lastDetectedAt: now,
        resolvedAt: null,
        updatedAt: now,
      }).where(eq(attendanceExceptionEvents.id, found.id));
      continue;
    }

    const [inserted] = await db.insert(attendanceExceptionEvents).values({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      workDate: input.workDate,
      exceptionKind: item.exception.kind,
      severity: item.exception.severity,
      punchId: item.exception.punchId ?? null,
      minutes: item.exception.minutes ?? null,
      message: item.exception.message,
      fingerprintSha256: item.fingerprint,
      status: "open",
      slaDueAt: attendanceExceptionSlaDueAt({
        firstDetectedAt: now,
        severity: item.exception.severity,
      }),
      firstDetectedAt: now,
      lastDetectedAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning();

    if (inserted) created.push(inserted);
  }

  const resolvedIds = [];
  for (const row of existing) {
    if (row.status !== "open" || currentFingerprints.has(row.fingerprintSha256)) continue;
    const [resolved] = await db.update(attendanceExceptionEvents).set({
      status: "resolved",
      resolvedAt: now,
      updatedAt: now,
    }).where(and(
      eq(attendanceExceptionEvents.id, row.id),
      eq(attendanceExceptionEvents.status, "open"),
    )).returning({ id: attendanceExceptionEvents.id });
    if (resolved) resolvedIds.push(resolved.id);
  }

  const automation = [];
  for (const row of created) {
    automation.push(...await runAutomationEventSafely({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      trigger: "attendance.exception_created",
      eventKey: `attendance-exception-created:${row.id}`,
      context: {
        attendanceExceptionId: row.id,
        workDate: input.workDate,
        attendanceExceptionKind: row.exceptionKind,
        attendanceExceptionSeverity: row.severity,
        punchId: row.punchId,
        minutes: row.minutes,
        eventAmount: row.minutes ?? 0,
        message: row.message,
      },
    }));
  }

  return {
    analysis,
    createdIds: created.map((row) => row.id),
    resolvedIds,
    automation,
  };
}
