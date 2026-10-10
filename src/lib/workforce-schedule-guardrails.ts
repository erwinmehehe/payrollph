import type { ResolvedDailySchedule } from "@/lib/workforce-scheduling";

export type ScheduleGuardrailPolicy = {
  minimumRestMinutes: number;
  maxConsecutiveWorkingDays: number;
  rollingSevenDayMinutes: number;
  enforcementMode: "advisory" | "block";
  active: boolean;
};

export const DEFAULT_SCHEDULE_GUARDRAIL_POLICY: ScheduleGuardrailPolicy = {
  minimumRestMinutes: 0,
  maxConsecutiveWorkingDays: 0,
  rollingSevenDayMinutes: 0,
  enforcementMode: "advisory",
  active: true,
};

export type ScheduleGuardrailIssue = {
  code:
    | "segment_overlap"
    | "minimum_rest"
    | "consecutive_days"
    | "rolling_seven_day_minutes";
  severity: "critical" | "warning";
  blocking: boolean;
  date: string;
  relatedDate?: string | null;
  title: string;
  detail: string;
  actualMinutes?: number | null;
  thresholdMinutes?: number | null;
  actualDays?: number | null;
  thresholdDays?: number | null;
};

type AbsoluteInterval = {
  date: string;
  startMinute: number;
  endMinute: number;
  paidMinutes: number;
  label: string;
};

function dateOrdinal(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function timeMinute(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function intervalForSegment(
  day: ResolvedDailySchedule,
  segment: ResolvedDailySchedule["segments"][number],
): AbsoluteInterval {
  const dayBase = dateOrdinal(day.date) * 1440;
  const start = dayBase + timeMinute(segment.startTime);
  let end = dayBase + timeMinute(segment.endTime);
  if (segment.spansMidnight || end <= start) end += 1440;
  const grossMinutes = Math.max(0, end - start);
  return {
    date: day.date,
    startMinute: start,
    endMinute: end,
    paidMinutes: Math.max(0, grossMinutes - Math.max(0, segment.breakMinutes)),
    label: `${segment.shiftCode} ${segment.startTime}–${segment.endTime}`,
  };
}

function workingDateSet(days: ResolvedDailySchedule[]) {
  return new Set(
    days
      .filter((day) => !day.isRestDay && day.segments.length > 0)
      .map((day) => day.date),
  );
}

function policyBlocks(policy: ScheduleGuardrailPolicy) {
  return policy.active && policy.enforcementMode === "block";
}

export function evaluateScheduleGuardrails(input: {
  days: ResolvedDailySchedule[];
  policy: ScheduleGuardrailPolicy;
}): ScheduleGuardrailIssue[] {
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const policy = input.policy;
  const issues: ScheduleGuardrailIssue[] = [];
  const intervals = days
    .flatMap((day) => day.segments.map((segment) => intervalForSegment(day, segment)))
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

  // Sorted starts are not enough: a long shift can contain multiple shorter
  // segments. Compare with the interval ending latest so later overlaps and
  // subsequent rest gaps are evaluated against the true occupied boundary.
  let lastEnding: AbsoluteInterval | null = null;
  for (const current of intervals) {
    if (lastEnding) {
      if (current.startMinute < lastEnding.endMinute) {
        issues.push({
          code: "segment_overlap",
          severity: "critical",
          blocking: true,
          date: current.date,
          relatedDate: lastEnding.date,
          title: "Scheduled work overlaps",
          detail: `${current.label} overlaps ${lastEnding.label}. Overlapping scheduled intervals are always invalid.`,
        });
      } else if (policy.active && policy.minimumRestMinutes > 0) {
        const restMinutes = current.startMinute - lastEnding.endMinute;
        if (restMinutes < policy.minimumRestMinutes) {
          issues.push({
            code: "minimum_rest",
            severity: "warning",
            blocking: policyBlocks(policy),
            date: current.date,
            relatedDate: lastEnding.date,
            title: "Minimum rest policy breached",
            detail: `${Math.round(restMinutes / 60 * 10) / 10}h rest between scheduled work blocks; policy requires ${Math.round(policy.minimumRestMinutes / 60 * 10) / 10}h.`,
            actualMinutes: restMinutes,
            thresholdMinutes: policy.minimumRestMinutes,
          });
        }
      }
    }
    if (!lastEnding || current.endMinute > lastEnding.endMinute) {
      lastEnding = current;
    }
  }

  if (!policy.active) return issues;

  const workingDates = workingDateSet(days);
  if (policy.maxConsecutiveWorkingDays > 0 && workingDates.size > 0) {
    let streak = 0;
    let previousOrdinal: number | null = null;
    for (const day of days) {
      if (!workingDates.has(day.date)) {
        streak = 0;
        previousOrdinal = dateOrdinal(day.date);
        continue;
      }
      const ordinal = dateOrdinal(day.date);
      streak = previousOrdinal != null && ordinal === previousOrdinal + 1 ? streak + 1 : 1;
      previousOrdinal = ordinal;
      if (streak > policy.maxConsecutiveWorkingDays) {
        issues.push({
          code: "consecutive_days",
          severity: "warning",
          blocking: policyBlocks(policy),
          date: day.date,
          title: "Consecutive working-day policy breached",
          detail: `${streak} consecutive scheduled working days; policy limit is ${policy.maxConsecutiveWorkingDays}.`,
          actualDays: streak,
          thresholdDays: policy.maxConsecutiveWorkingDays,
        });
      }
    }
  }

  if (policy.rollingSevenDayMinutes > 0) {
    const dailyMinutes = new Map<string, number>();
    for (const interval of intervals) {
      dailyMinutes.set(
        interval.date,
        (dailyMinutes.get(interval.date) ?? 0) + interval.paidMinutes,
      );
    }

    for (let endIndex = 0; endIndex < days.length; endIndex += 1) {
      const endDate = days[endIndex].date;
      const endOrdinal = dateOrdinal(endDate);
      let total = 0;
      for (const [date, minutes] of dailyMinutes) {
        const delta = endOrdinal - dateOrdinal(date);
        if (delta >= 0 && delta <= 6) total += minutes;
      }
      if (total > policy.rollingSevenDayMinutes) {
        issues.push({
          code: "rolling_seven_day_minutes",
          severity: "warning",
          blocking: policyBlocks(policy),
          date: endDate,
          title: "Rolling 7-day hours policy breached",
          detail: `${Math.round(total / 60 * 10) / 10}h scheduled in the trailing 7 days; policy threshold is ${Math.round(policy.rollingSevenDayMinutes / 60 * 10) / 10}h.`,
          actualMinutes: total,
          thresholdMinutes: policy.rollingSevenDayMinutes,
        });
      }
    }
  }

  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [
      issue.code,
      issue.date,
      issue.relatedDate ?? "",
      issue.actualMinutes ?? "",
      issue.actualDays ?? "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function scheduleGuardrailBlocksMutation(issues: ScheduleGuardrailIssue[]) {
  return issues.some((issue) => issue.blocking);
}
