import type { ResolvedDailySchedule } from "@/lib/workforce-scheduling";

/**
 * Advisory check-in watch for Philippine scheduled shifts. A missing signal is
 * only a prompt to investigate attendance, never evidence of absence, fraud,
 * unpaid time or authorization to amend payroll.
 */
export type ClockInWatchCandidate = {
  organizationId: number;
  employeeId: number;
  employeeStatus: string;
  employmentStartDate: string;
  schedule: ResolvedDailySchedule;
  punches: Array<{ timeIn: Date | string | null; timeOut: Date | string | null }>;
  approvedLeaveOnDate: boolean;
  conflictingSeparation: boolean;
};

export type ClockInWatchSignal = {
  organizationId: number;
  employeeId: number;
  workDate: string;
  shiftDefinitionId: number;
  shiftStartTime: string;
  shiftName: string;
  segmentOrder: number;
  minutesSinceShiftStart: number;
  worksiteId: number | null;
  eventKey: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const MAX_WATCH_AGE_MINUTES = 180;
const EARLY_CLOCK_IN_ALLOWANCE_MINUTES = 120;

function instant(date: string, time: string): number | null {
  if (!ISO_DATE.test(date) || !LOCAL_TIME.test(time)) return null;
  const day = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  const stamp = Date.parse(date + "T" + (time.length === 5 ? time + ":00" : time) + "+08:00");
  return Number.isFinite(stamp) ? stamp : null;
}

function validPunchTime(value: Date | string | null): number | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clockInWatchSignals(input: {
  candidate: ClockInWatchCandidate;
  now: Date;
  graceMinutes: number;
}): ClockInWatchSignal[] {
  const { candidate, now, graceMinutes } = input;
  if (!Number.isFinite(now.getTime())
    || !Number.isSafeInteger(graceMinutes) || graceMinutes < 5 || graceMinutes > 60
    || !Number.isSafeInteger(candidate.organizationId) || candidate.organizationId <= 0
    || !Number.isSafeInteger(candidate.employeeId) || candidate.employeeId <= 0
    || candidate.employeeStatus !== "Active"
    || candidate.approvedLeaveOnDate || candidate.conflictingSeparation
    || candidate.schedule.source === "unassigned" || candidate.schedule.isRestDay
    || candidate.schedule.segments.length === 0
    || !ISO_DATE.test(candidate.employmentStartDate)
    || candidate.employmentStartDate > candidate.schedule.date) {
    return [];
  }
  // Unknown/invalid punch timestamps are correction evidence, not a reason to
  // declare that the employee failed to clock in.
  if (candidate.punches.some(p => p.timeIn === null || validPunchTime(p.timeIn) === null)) return [];
  const punched = candidate.punches.map(p => validPunchTime(p.timeIn)).filter((v): v is number => v !== null);
  const signals: ClockInWatchSignal[] = [];
  for (const segment of candidate.schedule.segments) {
    const start = instant(candidate.schedule.date, segment.startTime);
    const endWall = instant(candidate.schedule.date, segment.endTime);
    if (start === null || endWall === null) continue;
    const end = endWall <= start && segment.spansMidnight ? endWall + 86_400_000 : endWall;
    // Invalid or contradictory shift lengths must be reconciled in Scheduling.
    if (end <= start || end - start > 24 * 3_600_000) continue;
    const elapsed = Math.floor((now.getTime() - start) / 60_000);
    if (elapsed < graceMinutes || elapsed > MAX_WATCH_AGE_MINUTES || now.getTime() >= end) continue;

    // A single shift with any valid clock-in is not eligible for this alert.
    // Multiple daily segments must match their own clock-in window, while an
    // earlier open punch may still mean the employee is already working.
    const hasEvidence = candidate.schedule.segments.length === 1
      ? punched.length > 0
      : punched.some(time => time >= start - EARLY_CLOCK_IN_ALLOWANCE_MINUTES * 60_000
          && time <= now.getTime())
        || candidate.punches.some(p => validPunchTime(p.timeIn)! < start
          && p.timeOut === null);
    if (hasEvidence) continue;
    const eventKey = [
      "wfm-clock-in-watch-v1", candidate.organizationId, candidate.employeeId,
      candidate.schedule.date, candidate.schedule.assignmentId ?? 0,
      candidate.schedule.overrideId ?? 0, segment.shiftDefinitionId,
      segment.segmentOrder, segment.startTime,
    ].join(":");
    signals.push({
      organizationId: candidate.organizationId,
      employeeId: candidate.employeeId,
      workDate: candidate.schedule.date,
      shiftDefinitionId: segment.shiftDefinitionId,
      shiftStartTime: segment.startTime,
      shiftName: segment.shiftName,
      segmentOrder: segment.segmentOrder,
      minutesSinceShiftStart: elapsed,
      worksiteId: candidate.schedule.worksiteId,
      eventKey,
    });
  }
  return signals;
}
