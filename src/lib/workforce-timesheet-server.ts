import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests,
  leaveRequestIntervals,
  leaveRequestIntervalSets,
  leaveRequests,
  overtimeRequests,
  timePunches,
  workforceTimesheetPolicies,
  workforceTimesheets,
} from "@/db/schema";
import { analyzeAttendanceDay } from "@/lib/workforce-attendance";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import {
  dateCoveredByApprovedLeave,
  datesBetween,
  evaluateTimesheetPayrollGate,
  hashTimesheetSnapshot,
  scheduledMinutesForDay,
  type TimesheetPolicy,
} from "@/lib/workforce-timesheet";
import type { OvertimeRequestEvidence } from "@/lib/workforce-overtime";
import { approvedLeaveCoverageImpact } from "@/lib/workforce-absence";
import { resolveLeaveIntervalsForSchedule, type PreciseLeaveInterval } from "@/lib/workforce-absence-intervals";

export async function loadTimesheetPolicy(organizationId: number): Promise<TimesheetPolicy> {
  const [row] = await db.select().from(workforceTimesheetPolicies)
    .where(eq(workforceTimesheetPolicies.organizationId, organizationId))
    .limit(1);
  if (!row) return { active: true, enforcementMode: "advisory" };
  return {
    active: row.active,
    enforcementMode: row.enforcementMode === "block" ? "block" : "advisory",
  };
}

export async function buildEmployeeTimesheetSnapshot(input: {
  organizationId: number;
  employeeId: number;
  periodStart: string;
  periodEnd: string;
}) {
  const dates = datesBetween(input.periodStart, input.periodEnd);
  if (dates.length === 0 || dates.length > 31) {
    throw new Error("Timesheet period must be a valid date range of 31 days or fewer.");
  }

  const [schedules, punches, overtimeRows, correctionRows, leaveRows] = await Promise.all([
    resolveEmployeeScheduleWindow({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      startDate: input.periodStart,
      endDate: input.periodEnd,
    }),
    db.select().from(timePunches).where(and(
      eq(timePunches.organizationId, input.organizationId),
      eq(timePunches.employeeId, input.employeeId),
      gte(timePunches.workDate, input.periodStart),
      lte(timePunches.workDate, input.periodEnd),
    )).orderBy(asc(timePunches.workDate), asc(timePunches.id)),
    db.select().from(overtimeRequests).where(and(
      eq(overtimeRequests.organizationId, input.organizationId),
      eq(overtimeRequests.employeeId, input.employeeId),
      gte(overtimeRequests.workDate, input.periodStart),
      lte(overtimeRequests.workDate, input.periodEnd),
    )).orderBy(asc(overtimeRequests.workDate), asc(overtimeRequests.id)),
    db.select().from(attendanceCorrectionRequests).where(and(
      eq(attendanceCorrectionRequests.organizationId, input.organizationId),
      eq(attendanceCorrectionRequests.employeeId, input.employeeId),
      gte(attendanceCorrectionRequests.workDate, input.periodStart),
      lte(attendanceCorrectionRequests.workDate, input.periodEnd),
      eq(attendanceCorrectionRequests.status, "pending"),
    )).orderBy(asc(attendanceCorrectionRequests.workDate), asc(attendanceCorrectionRequests.id)),
    db.select().from(leaveRequests).where(and(
      eq(leaveRequests.organizationId, input.organizationId),
      eq(leaveRequests.employeeId, input.employeeId),
      lte(leaveRequests.startDate, input.periodEnd),
      gte(leaveRequests.endDate, input.periodStart),
    )).orderBy(asc(leaveRequests.startDate), asc(leaveRequests.id)),
  ]);

  const approvedLeaveRows = leaveRows.filter((row) => row.status === "Approved");
  const currentIntervalSets = approvedLeaveRows.length
    ? await db.select().from(leaveRequestIntervalSets).where(and(
        eq(leaveRequestIntervalSets.organizationId, input.organizationId),
        eq(leaveRequestIntervalSets.status, "current"),
        inArray(leaveRequestIntervalSets.leaveRequestId, approvedLeaveRows.map((row) => row.id)),
      ))
    : [];
  const currentIntervalSetIds = currentIntervalSets.map((row) => row.id);
  const currentIntervals = currentIntervalSetIds.length
    ? await db.select().from(leaveRequestIntervals).where(and(
        eq(leaveRequestIntervals.organizationId, input.organizationId),
        inArray(leaveRequestIntervals.intervalSetId, currentIntervalSetIds),
      ))
    : [];
  const intervalSetByLeaveId = new Map(currentIntervalSets.map((row) => [row.leaveRequestId, row]));

  const scheduleByDate = new Map(schedules.map((day) => [day.date, day]));
  const punchesByDate = new Map<string, typeof punches>();
  for (const punch of punches) {
    const date = String(punch.workDate);
    punchesByDate.set(date, [...(punchesByDate.get(date) ?? []), punch]);
  }
  const overtimeByDate = new Map<string, OvertimeRequestEvidence[]>();
  for (const row of overtimeRows) {
    const date = String(row.workDate);
    overtimeByDate.set(date, [
      ...(overtimeByDate.get(date) ?? []),
      {
        id: row.id,
        status: row.status as OvertimeRequestEvidence["status"],
        requestKind: row.requestKind as OvertimeRequestEvidence["requestKind"],
        requestedMinutes: row.requestedMinutes,
        requestedByUserId: row.requestedByUserId,
        decidedByUserId: row.decidedByUserId,
      },
    ]);
  }
  const correctionsByDate = new Map<string, number[]>();
  for (const row of correctionRows) {
    const date = String(row.workDate);
    correctionsByDate.set(date, [...(correctionsByDate.get(date) ?? []), row.id]);
  }

  let scheduledMinutes = 0;
  let workedMinutes = 0;
  let overtimeMinutes = 0;
  let exceptionCount = 0;
  let blockerCount = 0;

  const days = dates.map((date) => {
    const schedule = scheduleByDate.get(date);
    if (!schedule) throw new Error(`Resolved schedule missing for ${date}.`);
    const dayPunches = punchesByDate.get(date) ?? [];
    const approvedLeavesForDate = approvedLeaveRows.filter(
      (leave) => String(leave.startDate) <= date && String(leave.endDate) >= date,
    );
    const preciseLeave = approvedLeavesForDate.flatMap((leave) => {
      const intervalSet = intervalSetByLeaveId.get(leave.id);
      if (!intervalSet) return [];
      const intervals = currentIntervals
        .filter((row) => row.intervalSetId === intervalSet.id && String(row.workDate) === date)
        .map((row) => ({
          workDate: String(row.workDate),
          kind: row.kind as PreciseLeaveInterval["kind"],
          startLocalTime: row.startLocalTime,
          endLocalTime: row.endLocalTime,
          endsNextDay: row.endsNextDay,
          timezone: row.timezone,
        }));
      return [{
        leaveId: leave.id,
        intervalSetId: intervalSet.id,
        intervalRevision: intervalSet.revision,
        intervals,
      }];
    });
    const preciseImpacts = preciseLeave.map((evidence) => ({
      ...evidence,
      impact: resolveLeaveIntervalsForSchedule({
        workDate: date,
        intervals: evidence.intervals,
        schedule,
      }),
    }));
    const preciseFullDayLeave = preciseLeave.some((evidence) =>
      evidence.intervals.some((interval) => interval.kind === "full_day"),
    );
    const legacyFullDayLeave = approvedLeavesForDate.some((leave) => {
      if (intervalSetByLeaveId.has(leave.id)) return false;
      return approvedLeaveCoverageImpact({
        id: leave.id,
        employeeId: leave.employeeId,
        startDate: String(leave.startDate),
        endDate: String(leave.endDate),
        days: Number(leave.days),
        leaveType: leave.leaveType,
      }).kind === "full_day";
    });
    const onApprovedLeave = preciseFullDayLeave || legacyFullDayLeave;
    const leaveWorkOverlap = dayPunches.length > 0
      && preciseImpacts.some((evidence) => evidence.impact.unavailableWallMinutes > 0);

    const analysis = analyzeAttendanceDay({
      date,
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
      overtimeRequests: overtimeByDate.get(date) ?? [],
    });

    let exceptions = analysis.exceptions;
    if (onApprovedLeave && dayPunches.length === 0) {
      exceptions = exceptions.filter((exception) => exception.kind !== "missing_punch");
    }

    if (leaveWorkOverlap) {
      exceptions = [
        ...exceptions,
        {
          kind: "clock_integrity" as const,
          severity: "warning" as const,
          message: `${date}: Approved leave overlaps recorded work. Review the attendance and leave evidence; punches are preserved and pay is not suppressed automatically.`,
        },
      ];
    }

    const pendingCorrectionIds = correctionsByDate.get(date) ?? [];
    if (pendingCorrectionIds.length > 0) {
      exceptions = [
        ...exceptions,
        {
          kind: "clock_integrity" as const,
          severity: "blocker" as const,
          message: `${date}: attendance correction request(s) ${pendingCorrectionIds.join(", ")} are still pending.`,
        },
      ];
    }

    const dayScheduledMinutes = scheduledMinutesForDay(schedule);
    const dayBlockers = exceptions.filter((exception) => exception.severity === "blocker").length;
    scheduledMinutes += dayScheduledMinutes;
    workedMinutes += analysis.workedMinutes;
    overtimeMinutes += analysis.overtimeMinutes;
    exceptionCount += exceptions.length;
    blockerCount += dayBlockers;

    return {
      date,
      leave: onApprovedLeave,
      preciseLeave: preciseImpacts.map((evidence) => ({
        leaveId: evidence.leaveId,
        intervalSetId: evidence.intervalSetId,
        intervalRevision: evidence.intervalRevision,
        intervals: evidence.intervals,
        unavailableWallMinutes: evidence.impact.unavailableWallMinutes,
        unavailablePaidMinutes: evidence.impact.unavailablePaidMinutes,
        warnings: evidence.impact.warnings,
        blockers: evidence.impact.blockers,
      })),
      leaveWorkOverlap,
      schedule: {
        source: schedule.source,
        isRestDay: schedule.isRestDay,
        worksiteId: schedule.worksiteId,
        scheduledMinutes: dayScheduledMinutes,
        segments: schedule.segments.map((segment) => ({
          shiftDefinitionId: segment.shiftDefinitionId,
          shiftCode: segment.shiftCode,
          startTime: segment.startTime,
          endTime: segment.endTime,
          breakMinutes: segment.breakMinutes,
          spansMidnight: segment.spansMidnight,
        })),
      },
      punches: dayPunches.map((punch) => ({
        id: punch.id,
        timeIn: punch.timeIn?.toISOString?.() ?? punch.timeIn ?? null,
        timeOut: punch.timeOut?.toISOString?.() ?? punch.timeOut ?? null,
        breakStart: punch.breakStart?.toISOString?.() ?? punch.breakStart ?? null,
        breakEnd: punch.breakEnd?.toISOString?.() ?? punch.breakEnd ?? null,
        status: punch.status,
        source: punch.source,
      })),
      workedMinutes: analysis.workedMinutes,
      overtimeMinutes: analysis.overtimeMinutes,
      tardinessMinutes: analysis.tardinessMinutes,
      undertimeMinutes: analysis.undertimeMinutes,
      exceptions,
      blockerCount: dayBlockers,
      overtimeAuthorization: analysis.overtimeAuthorization,
      pendingCorrectionIds,
    };
  });

  const snapshot = {
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    scheduledMinutes,
    workedMinutes,
    overtimeMinutes,
    exceptionCount,
    blockerCount,
    days,
  };

  return {
    snapshot,
    snapshotHash: hashTimesheetSnapshot(snapshot),
    scheduledMinutes,
    workedMinutes,
    overtimeMinutes,
    exceptionCount,
    blockerCount,
  };
}

export async function latestTimesheetsForPeriod(input: {
  organizationId: number;
  employeeIds: number[];
  periodStart: string;
  periodEnd: string;
}) {
  if (input.employeeIds.length === 0) return [];
  const rows = await db.select().from(workforceTimesheets).where(and(
    eq(workforceTimesheets.organizationId, input.organizationId),
    inArray(workforceTimesheets.employeeId, input.employeeIds),
    eq(workforceTimesheets.periodStart, input.periodStart),
    eq(workforceTimesheets.periodEnd, input.periodEnd),
  )).orderBy(asc(workforceTimesheets.employeeId), desc(workforceTimesheets.version));

  const latest = new Map<number, typeof rows[number]>();
  for (const row of rows) {
    if (!latest.has(row.employeeId)) latest.set(row.employeeId, row);
  }
  return [...latest.values()];
}

export async function loadTimesheetPayrollGate(input: {
  organizationId: number;
  employeeIds: number[];
  periodStart: string;
  periodEnd: string;
}) {
  const [policy, latest] = await Promise.all([
    loadTimesheetPolicy(input.organizationId),
    latestTimesheetsForPeriod(input),
  ]);
  return {
    policy,
    timesheets: latest,
    gate: evaluateTimesheetPayrollGate({
      policy,
      employeeIds: input.employeeIds,
      latestTimesheets: latest.map((row) => ({
        employeeId: row.employeeId,
        status: row.status,
        version: row.version,
      })),
    }),
  };
}

export async function markTimesheetsStaleForEmployeeRange(input: {
  organizationId: number;
  employeeId: number;
  startDate: string;
  endDate?: string | null;
}) {
  const endDate = input.endDate ?? "9999-12-31";
  return db.update(workforceTimesheets).set({
    status: "stale",
    updatedAt: new Date(),
  }).where(and(
    eq(workforceTimesheets.organizationId, input.organizationId),
    eq(workforceTimesheets.employeeId, input.employeeId),
    lte(workforceTimesheets.periodStart, endDate),
    gte(workforceTimesheets.periodEnd, input.startDate),
    inArray(workforceTimesheets.status, ["submitted", "approved"]),
  )).returning({ id: workforceTimesheets.id, version: workforceTimesheets.version });
}

export async function markTimesheetsStaleForEmployeeDate(input: {
  organizationId: number;
  employeeId: number;
  workDate: string;
}) {
  return markTimesheetsStaleForEmployeeRange({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    startDate: input.workDate,
    endDate: input.workDate,
  });
}
