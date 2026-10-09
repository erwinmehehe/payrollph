/**
 * Advisory WFM live-floor classification. No attendance correction, absence
 * finding or payroll entitlement may be inferred from this read-only view.
 * Shift anchors use the Philippine +08:00 civil clock (no DST).
 */
import type { ResolvedScheduleSegment } from "./workforce-scheduling";

export type FloorSignal =
  | "clocked_in" | "break_recorded" | "clocked_out"
  | "upcoming" | "check_in_window"
  | "clock_in_unconfirmed" | "missing_punch_review"
  | "approved_leave" | "leave_timing_review" | "leave_punch_review"
  | "punch_evidence_review" | "employment_review";

export type FloorPunch = {
  id: number;
  timeIn: Date | string | null;
  timeOut: Date | string | null;
  breakStart?: Date | string | null;
  breakEnd?: Date | string | null;
};

export type FloorRow = {
  key: string;
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  workDate: string;
  worksiteId: number | null;
  shiftName: string;
  shiftCode: string;
  segmentOrder: number;
  startsAt: string;
  endsAt: string;
  status: FloorSignal;
  explanation: string;
  punchCount: number;
};

type FloorInput = {
  now: Date;
  employee: { id: number; employeeNo: string; name: string; status: string };
  workDate: string;
  worksiteId: number | null;
  segment: ResolvedScheduleSegment;
  punches: FloorPunch[];
  leave: "none" | "full" | "partial_or_uncertain";
  graceMinutes?: number;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function minuteOfDay(value: string): number {
  const match = TIME.exec(value);
  if (!match) throw new Error("Invalid shift time evidence.");
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
}

function atManila(workDate: string, clock: string): number {
  const match = TIME.exec(clock);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new Error("Invalid Philippine schedule date or clock.");
  }
  const instant = Date.parse(workDate + "T" + match[1] + ":" + match[2] + ":" + (match[3] || "00") + "+08:00");
  if (!Number.isFinite(instant) || new Date(instant + 8 * 3600000).toISOString().slice(0, 10) !== workDate) {
    throw new Error("Invalid schedule calendar date.");
  }
  return instant;
}

/** Overnight is anchored to the original work date, including split shifts. */
export function floorSegmentBounds(workDate: string, segment: ResolvedScheduleSegment) {
  const start = atManila(workDate, segment.startTime);
  const endMinute = minuteOfDay(segment.endTime);
  const startMinute = minuteOfDay(segment.startTime);
  let end = atManila(workDate, segment.endTime);
  if (segment.spansMidnight || endMinute <= startMinute) end += 86_400_000;
  if (end <= start || end - start > 86_400_000) throw new Error("Invalid segment duration.");
  return { start, end };
}

function timeValue(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

const REVIEW_STATUSES = new Set<FloorSignal>([
  "clock_in_unconfirmed", "missing_punch_review", "leave_timing_review",
  "leave_punch_review", "punch_evidence_review", "employment_review",
]);

export function classifyFloorSegment(input: FloorInput): FloorRow {
  const { now, employee, workDate, worksiteId, segment } = input;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Live-floor clock is invalid.");
  const { start, end } = floorSegmentBounds(workDate, segment);
  const grace = Number.isInteger(input.graceMinutes) && input.graceMinutes! >= 5 && input.graceMinutes! <= 60
    ? input.graceMinutes! : 15;

  let malformed = false;
  const candidates: Array<{ inAt: number; outAt: number | null; breakAt: number | null; breakEndAt: number | null }> = [];
  for (const punch of input.punches) {
    const inAt = timeValue(punch.timeIn);
    const outAt = timeValue(punch.timeOut);
    const breakAt = timeValue(punch.breakStart);
    const breakEndAt = timeValue(punch.breakEnd);
    if (inAt == null) {
      if (outAt !== null || breakAt !== null || breakEndAt !== null) malformed = true;
      continue;
    }
    // Punches can be clocked early. Never credit one unrelated punch to every split segment.
    // Bound punch attribution to each segment. A punch for an earlier split
    // shift must not automatically make a later shift look attended.
    if (!Number.isFinite(inAt) || inAt < start - 2 * 3600000 || inAt > end) continue;
    if (outAt !== null && Number.isFinite(outAt) && outAt <= start) continue;
    if (
      [outAt, breakAt, breakEndAt].some(value => value !== null && !Number.isFinite(value))
      || inAt > nowMs + 5 * 60000
      || (outAt !== null && (outAt < inAt || outAt > nowMs + 5 * 60000))
      || (breakAt !== null && (breakAt < inAt || breakAt > nowMs + 5 * 60000))
      || (breakEndAt !== null && (breakAt === null || breakEndAt < breakAt))
      || (outAt !== null && breakAt !== null && breakEndAt === null)
    ) {
      malformed = true;
      continue;
    }
    candidates.push({ inAt, outAt, breakAt, breakEndAt });
  }

  const base = {
    key: employee.id + ":" + workDate + ":" + segment.segmentOrder,
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    employeeName: employee.name,
    workDate,
    worksiteId,
    shiftName: segment.shiftName,
    shiftCode: segment.shiftCode,
    segmentOrder: segment.segmentOrder,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    punchCount: candidates.length,
  };
  const withSignal = (status: FloorSignal, explanation: string): FloorRow => ({ ...base, status, explanation });

  if (malformed || candidates.filter(p => p.outAt === null).length > 1) {
    return withSignal("punch_evidence_review", "Conflicting, incomplete or clock-skewed punch evidence needs a timecard review.");
  }
  if (!["active", "on leave"].includes(employee.status.trim().toLowerCase())) {
    return withSignal("employment_review", "Worker employment status requires source review; no attendance conclusion is made.");
  }
  if (input.leave === "full") {
    return candidates.length
      ? withSignal("leave_punch_review", "An approved full-day leave and recorded punch overlap. Review both sources.")
      : withSignal("approved_leave", "Approved full-day leave recorded for this work date.");
  }
  if (input.leave === "partial_or_uncertain" && candidates.length === 0) {
    return withSignal("leave_timing_review", "Approved partial or imprecise leave overlaps this shift; verify the interval.");
  }
  const open = candidates.find(p => p.outAt === null);
  if (open) {
    if (nowMs > end + 60 * 60000) {
      return withSignal("punch_evidence_review", "Time-in remains open well beyond the scheduled shift; review time-out.");
    }
    if (open.breakAt !== null && open.breakEndAt === null) {
      return withSignal("break_recorded", "A break start is recorded without a break end. Presence is not independently verified.");
    }
    return withSignal("clocked_in", "Time-in recorded; current physical presence is not independently verified.");
  }
  if (candidates.length) {
    return withSignal("clocked_out", "Time-in and time-out recorded; review the timecard for completeness.");
  }
  if (nowMs < start) return withSignal("upcoming", "Scheduled shift has not started.");
  if (nowMs < start + grace * 60000) {
    return withSignal("check_in_window", "Scheduled start is within the manager's grace window.");
  }
  if (nowMs <= end) {
    return withSignal("clock_in_unconfirmed", "No usable clock-in recorded after the review grace window. Not an absence finding.");
  }
  return withSignal("missing_punch_review", "Shift window ended without a usable time-in. Reconcile punches or leave; not an absence finding.");
}

export function summarizeFloor(rows: FloorRow[]) {
  return {
    shiftSegments: rows.length,
    requiresReview: rows.filter(row => REVIEW_STATUSES.has(row.status)).length,
    recordedIn: rows.filter(row => row.status === "clocked_in" || row.status === "break_recorded").length,
    recordedOut: rows.filter(row => row.status === "clocked_out").length,
    scheduledLater: rows.filter(row => row.status === "upcoming" || row.status === "check_in_window").length,
    approvedLeave: rows.filter(row => row.status === "approved_leave").length,
  };
}

export function floorNeedsReview(status: FloorSignal): boolean {
  return REVIEW_STATUSES.has(status);
}
