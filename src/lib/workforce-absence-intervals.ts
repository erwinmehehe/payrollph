import type { ResolvedDailySchedule, ResolvedScheduleSegment } from "@/lib/workforce-scheduling";

export type PreciseLeaveInterval = {
  kind: "full_day" | "first_half" | "second_half" | "timed";
  workDate: string;
  startLocalTime?: string | null;
  endLocalTime?: string | null;
  endsNextDay?: boolean;
  timezone: string;
};

export type AbsenceFinding = {
  code: "SCHEDULE_REQUIRED" | "BREAK_PLACEMENT_UNKNOWN" | "INVALID_INTERVAL";
  message: string;
};

export type LeaveSegmentImpact = {
  segmentOrder: number;
  unavailableWallMinutes: number;
  unavailablePaidMinutes: number | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function timeMinutes(value: string) {
  const match = TIME.exec(value);
  if (!match) throw new Error("Time must use 24-hour HH:MM or HH:MM:SS.");
  return Number(match[1]) * 60 + Number(match[2]);
}

function segmentWallMinutes(segment: ResolvedScheduleSegment) {
  const start = timeMinutes(segment.startTime);
  let end = timeMinutes(segment.endTime);
  if (segment.spansMidnight || end <= start) end += 1440;
  return Math.max(0, end - start);
}

function segmentPaidMinutes(segment: ResolvedScheduleSegment) {
  return Math.max(0, segmentWallMinutes(segment) - Math.max(0, Number(segment.breakMinutes ?? 0)));
}

function timedBounds(interval: PreciseLeaveInterval) {
  if (!interval.startLocalTime || !interval.endLocalTime) {
    throw new Error("Timed leave requires startLocalTime and endLocalTime.");
  }
  const start = timeMinutes(interval.startLocalTime);
  let end = timeMinutes(interval.endLocalTime);
  if (interval.endsNextDay) end += 1440;
  return { start, end };
}

function segmentBounds(segment: ResolvedScheduleSegment) {
  const start = timeMinutes(segment.startTime);
  let end = timeMinutes(segment.endTime);
  if (segment.spansMidnight || end <= start) end += 1440;
  return { start, end };
}

function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function validateLeaveIntervals(intervals: PreciseLeaveInterval[]) {
  const errors: string[] = [];
  const byDate = new Map<string, PreciseLeaveInterval[]>();

  for (const interval of intervals) {
    if (!ISO_DATE.test(interval.workDate)) errors.push("Leave interval workDate must use YYYY-MM-DD.");
    if (!["full_day", "first_half", "second_half", "timed"].includes(interval.kind)) {
      errors.push("Unsupported leave interval kind.");
    }
    if (!interval.timezone?.trim()) errors.push("Leave interval timezone is required.");
    if (interval.kind === "timed") {
      try {
        const { start, end } = timedBounds(interval);
        if (end <= start) errors.push("Timed leave must end after it starts.");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Invalid timed leave.");
      }
    } else if (interval.startLocalTime || interval.endLocalTime || interval.endsNextDay) {
      errors.push("Only timed leave can contain clock times or cross midnight.");
    }
    const rows = byDate.get(interval.workDate) ?? [];
    rows.push(interval);
    byDate.set(interval.workDate, rows);
  }

  for (const rows of byDate.values()) {
    const broad = rows.filter((row) => row.kind !== "timed");
    if (broad.length > 1 || (broad.length === 1 && rows.length > 1)) {
      errors.push("Full-day or half-day leave cannot overlap another leave interval on the same date.");
      continue;
    }
    const timed = rows.filter((row) => row.kind === "timed");
    const bounds = timed.map((row) => timedBounds(row)).sort((a, b) => a.start - b.start);
    for (let index = 1; index < bounds.length; index += 1) {
      if (bounds[index].start < bounds[index - 1].end) {
        errors.push("Timed leave intervals cannot overlap.");
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function halfDayImpacts(
  segments: ResolvedScheduleSegment[],
  kind: "first_half" | "second_half",
): LeaveSegmentImpact[] {
  const sorted = [...segments].sort((a, b) => a.segmentOrder - b.segmentOrder);
  const paidBySegment = sorted.map((segment) => segmentPaidMinutes(segment));
  const totalPaid = paidBySegment.reduce((sum, value) => sum + value, 0);
  const target = totalPaid / 2;
  let remaining = target;
  const amounts = new Map<number, number>();

  const ordered = kind === "first_half" ? sorted : [...sorted].reverse();
  for (const segment of ordered) {
    const available = segmentPaidMinutes(segment);
    const take = Math.min(remaining, available);
    amounts.set(segment.segmentOrder, take);
    remaining -= take;
    if (remaining <= 0) break;
  }

  return sorted.map((segment) => {
    const paid = amounts.get(segment.segmentOrder) ?? 0;
    return {
      segmentOrder: segment.segmentOrder,
      unavailableWallMinutes: paid,
      unavailablePaidMinutes: paid,
    };
  });
}

export function resolveLeaveIntervalsForSchedule(input: {
  workDate: string;
  intervals: PreciseLeaveInterval[];
  schedule: ResolvedDailySchedule;
}) {
  const blockers: AbsenceFinding[] = [];
  const warnings: AbsenceFinding[] = [];
  const validation = validateLeaveIntervals(input.intervals);
  if (!validation.ok) {
    blockers.push(...validation.errors.map((message) => ({ code: "INVALID_INTERVAL" as const, message })));
  }

  const relevant = input.intervals.filter((interval) => interval.workDate === input.workDate);
  const segments = [...input.schedule.segments].sort((a, b) => a.segmentOrder - b.segmentOrder);
  const totalPaid = segments.reduce((sum, segment) => sum + segmentPaidMinutes(segment), 0);

  if (segments.length === 0 && relevant.some((interval) => interval.kind !== "full_day")) {
    blockers.push({
      code: "SCHEDULE_REQUIRED",
      message: "A work schedule is required to resolve half-day or timed leave.",
    });
  }

  const impactByOrder = new Map<number, LeaveSegmentImpact>();
  for (const segment of segments) {
    impactByOrder.set(segment.segmentOrder, {
      segmentOrder: segment.segmentOrder,
      unavailableWallMinutes: 0,
      unavailablePaidMinutes: 0,
    });
  }

  let paidUnknown = false;

  for (const interval of relevant) {
    if (interval.kind === "full_day") {
      for (const segment of segments) {
        impactByOrder.set(segment.segmentOrder, {
          segmentOrder: segment.segmentOrder,
          unavailableWallMinutes: segmentWallMinutes(segment),
          unavailablePaidMinutes: segmentPaidMinutes(segment),
        });
      }
      continue;
    }

    if (interval.kind === "first_half" || interval.kind === "second_half") {
      if (segments.length === 0) continue;
      for (const impact of halfDayImpacts(segments, interval.kind)) {
        const current = impactByOrder.get(impact.segmentOrder)!;
        impactByOrder.set(impact.segmentOrder, {
          segmentOrder: impact.segmentOrder,
          unavailableWallMinutes: current.unavailableWallMinutes + impact.unavailableWallMinutes,
          unavailablePaidMinutes:
            current.unavailablePaidMinutes == null || impact.unavailablePaidMinutes == null
              ? null
              : current.unavailablePaidMinutes + impact.unavailablePaidMinutes,
        });
      }
      continue;
    }

    if (interval.kind === "timed" && segments.length > 0) {
      const leave = timedBounds(interval);
      for (const segment of segments) {
        const bounds = segmentBounds(segment);
        const wall = overlapMinutes(leave.start, leave.end, bounds.start, bounds.end);
        if (wall <= 0) continue;
        const current = impactByOrder.get(segment.segmentOrder)!;
        const wholeSegment = wall === bounds.end - bounds.start;
        let paid: number | null = wall;
        if (segment.breakMinutes > 0) {
          if (wholeSegment) {
            paid = segmentPaidMinutes(segment);
          } else {
            paid = null;
            paidUnknown = true;
          }
        }
        impactByOrder.set(segment.segmentOrder, {
          segmentOrder: segment.segmentOrder,
          unavailableWallMinutes: current.unavailableWallMinutes + wall,
          unavailablePaidMinutes:
            current.unavailablePaidMinutes == null || paid == null
              ? null
              : current.unavailablePaidMinutes + paid,
        });
      }
    }
  }

  if (paidUnknown) {
    warnings.push({
      code: "BREAK_PLACEMENT_UNKNOWN",
      message: "Timed leave overlaps a shift with an unpaid break whose exact clock placement is not recorded.",
    });
  }

  const segmentImpacts = [...impactByOrder.values()].sort((a, b) => a.segmentOrder - b.segmentOrder);
  const unavailableWallMinutes = segmentImpacts.reduce((sum, row) => sum + row.unavailableWallMinutes, 0);
  const unavailablePaidMinutes = segmentImpacts.some((row) => row.unavailablePaidMinutes == null)
    ? null
    : segmentImpacts.reduce((sum, row) => sum + Number(row.unavailablePaidMinutes ?? 0), 0);

  return {
    unavailableWallMinutes,
    unavailablePaidMinutes,
    partiallyAvailable:
      unavailablePaidMinutes == null
        ? unavailableWallMinutes > 0
        : unavailablePaidMinutes > 0 && unavailablePaidMinutes < totalPaid,
    blockers,
    warnings,
    segmentImpacts,
  };
}
