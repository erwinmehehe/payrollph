import { deriveClockHours } from "@/lib/payroll-rules";
import {
  basicPayForCutoff,
  resolvePayProfile,
  type EmployeePayProfileInput,
  type ResolvedPayProfile,
} from "@/lib/pay-basis";

export type EffectivePayRate = EmployeePayProfileInput & {
  effectiveFrom: string;
  id?: number;
};

export type PaySegment = {
  start: string;
  end: string;
  profile: ResolvedPayProfile;
  rateChangeId?: number;
};

type PunchLike = {
  workDate: string;
  timeIn: Date | string | null;
  timeOut: Date | string | null;
  shiftStart: string;
  shiftEnd: string;
};

const PHILIPPINE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toLocalIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Map(
    PHILIPPINE_TIME.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}`;
}

function dayNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function dateFromDayNumber(value: number) {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

export function inclusiveDays(start: string, end: string) {
  const count = dayNumber(end) - dayNumber(start) + 1;
  if (!Number.isFinite(count) || count <= 0) throw new Error("Invalid payroll date range.");
  return count;
}

export function previousDay(date: string) {
  return dateFromDayNumber(dayNumber(date) - 1);
}

export function nextDay(date: string) {
  return dateFromDayNumber(dayNumber(date) + 1);
}

export function effectiveProfileAt(input: {
  fallback: EmployeePayProfileInput;
  changes: EffectivePayRate[];
  date: string;
}) {
  const applicable = [...input.changes]
    .filter((change) => change.effectiveFrom <= input.date)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const selected = applicable.at(-1) ?? input.fallback;
  return resolvePayProfile(selected);
}

export function buildPaySegments(input: {
  fallback: EmployeePayProfileInput;
  changes: EffectivePayRate[];
  periodStart: string;
  periodEnd: string;
}) {
  if (input.periodStart > input.periodEnd) throw new Error("Payroll period start must be on or before period end.");

  const changes = [...input.changes]
    .filter((change) => change.effectiveFrom <= input.periodEnd)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  const starts = [
    input.periodStart,
    ...changes
      .filter((change) => change.effectiveFrom > input.periodStart && change.effectiveFrom <= input.periodEnd)
      .map((change) => change.effectiveFrom),
  ].filter((value, index, all) => all.indexOf(value) === index);

  const rawSegments = starts.map((start, index): PaySegment => {
    const nextStart = starts[index + 1];
    const end = nextStart ? previousDay(nextStart) : input.periodEnd;
    const applicable = changes
      .filter((change) => change.effectiveFrom <= start)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const selected = applicable.at(-1);
    return {
      start,
      end,
      profile: resolvePayProfile(selected ?? input.fallback),
      rateChangeId: selected?.id,
    };
  });

  const sameProfile = (left: ResolvedPayProfile, right: ResolvedPayProfile) =>
    left.payBasis === right.payBasis &&
    Math.abs(left.rateAmount - right.rateAmount) < 0.005 &&
    Math.abs(left.standardWorkDaysPerMonth - right.standardWorkDaysPerMonth) < 0.005 &&
    Math.abs(left.standardHoursPerDay - right.standardHoursPerDay) < 0.005;

  // A legacy baseline or duplicate effective-date record with identical values
  // is not a real pay change. Collapse adjacent identical segments so it does
  // not create fake proration, stale-release failures, or leave review blocks.
  return rawSegments.reduce<PaySegment[]>((segments, segment) => {
    const previous = segments.at(-1);
    if (previous && sameProfile(previous.profile, segment.profile)) {
      previous.end = segment.end;
      return segments;
    }
    segments.push({ ...segment });
    return segments;
  }, []);
}

export function regularMinutesForPunch(punch: PunchLike) {
  const derived = deriveClockHours(
    {
      timeIn: punch.timeIn ? toLocalIso(punch.timeIn) : null,
      timeOut: punch.timeOut ? toLocalIso(punch.timeOut) : null,
    },
    {
      start: punch.shiftStart,
      end: punch.shiftEnd,
      breakMinutes: 60,
      graceMinutes: 5,
    },
  );
  return Math.max(0, derived.workedMinutes - derived.overtimeMinutes);
}

export function calculateSegmentedBasicPay(input: {
  segments: PaySegment[];
  punches: PunchLike[];
  periodStart: string;
  periodEnd: string;
}) {
  if (input.segments.length === 0) throw new Error("At least one pay segment is required.");
  const bases = new Set(input.segments.map((segment) => segment.profile.payBasis));
  if (bases.size > 1) {
    throw new Error("A pay-basis change cannot take effect inside one payroll cutoff. Move the basis change to a cutoff boundary.");
  }

  const totalDays = inclusiveDays(input.periodStart, input.periodEnd);
  let basicPay = 0;
  let weightedMonthlyEquivalent = 0;
  const detail: Array<{
    start: string;
    end: string;
    payBasis: string;
    rateAmount: number;
    standardWorkDaysPerMonth: number;
    standardHoursPerDay: number;
    regularMinutes: number;
    amount: number;
  }> = [];

  for (const segment of input.segments) {
    const segmentDays = inclusiveDays(segment.start, segment.end);
    const punches = input.punches.filter((punch) => punch.workDate >= segment.start && punch.workDate <= segment.end);
    const regularMinutes = punches.reduce((sum, punch) => sum + regularMinutesForPunch(punch), 0);
    const amount = segment.profile.payBasis === "monthly"
      ? (segment.profile.rateAmount / 2) * (segmentDays / totalDays)
      : basicPayForCutoff(segment.profile, regularMinutes);

    basicPay += amount;
    weightedMonthlyEquivalent += segment.profile.monthlyEquivalent * (segmentDays / totalDays);
    detail.push({
      start: segment.start,
      end: segment.end,
      payBasis: segment.profile.payBasis,
      rateAmount: segment.profile.rateAmount,
      standardWorkDaysPerMonth: segment.profile.standardWorkDaysPerMonth,
      standardHoursPerDay: segment.profile.standardHoursPerDay,
      regularMinutes,
      amount,
    });
  }

  return {
    basicPay: round2(basicPay),
    weightedMonthlyEquivalent: round2(weightedMonthlyEquivalent),
    detail,
    changedWithinCutoff: input.segments.length > 1,
    payBasis: input.segments[0].profile.payBasis,
    endingProfile: input.segments.at(-1)!.profile,
  };
}

export function calculateMonthlyRetroDelta(input: {
  previousProfile: EmployeePayProfileInput;
  newProfile: EmployeePayProfileInput;
  runStart: string;
  runEnd: string;
  effectiveFrom: string;
  serviceThrough: string;
}) {
  const previous = resolvePayProfile(input.previousProfile);
  const next = resolvePayProfile(input.newProfile);
  if (previous.payBasis !== "monthly" || next.payBasis !== "monthly") {
    throw new Error("Monthly retro delta requires monthly salaried profiles.");
  }
  const overlapStart = input.effectiveFrom > input.runStart ? input.effectiveFrom : input.runStart;
  const overlapEnd = input.serviceThrough < input.runEnd ? input.serviceThrough : input.runEnd;
  if (overlapStart > overlapEnd) return 0;
  const fraction = inclusiveDays(overlapStart, overlapEnd) / inclusiveDays(input.runStart, input.runEnd);
  return round2(((next.rateAmount - previous.rateAmount) / 2) * fraction);
}

export function calculateWorkedRetroDelta(input: {
  previousProfile: EmployeePayProfileInput;
  newProfile: EmployeePayProfileInput;
  punches: PunchLike[];
  effectiveFrom: string;
  serviceThrough: string;
}) {
  const previous = resolvePayProfile(input.previousProfile);
  const next = resolvePayProfile(input.newProfile);
  if (previous.payBasis !== next.payBasis || previous.payBasis === "monthly") {
    throw new Error("Worked-time retro delta requires matching daily or hourly pay bases.");
  }
  const punches = input.punches.filter((punch) =>
    punch.workDate >= input.effectiveFrom && punch.workDate <= input.serviceThrough,
  );
  const minutes = punches.reduce((sum, punch) => sum + regularMinutesForPunch(punch), 0);
  return round2(
    basicPayForCutoff(next, minutes) - basicPayForCutoff(previous, minutes),
  );
}

export type PayrollLineLike = {
  code?: string;
  amount?: string | number;
  serviceYear?: number;
  thirteenthMonthEligible?: boolean;
};

export function basicSalaryEarnedFromLineItems(lineItems: unknown, serviceYear?: number) {
  const rows = Array.isArray(lineItems) ? lineItems as PayrollLineLike[] : [];
  let total = 0;
  for (const row of rows) {
    const code = String(row.code ?? "");
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) continue;

    if (code === "BASIC") {
      total += amount;
      continue;
    }
    if (code.startsWith("LEAVE-") && !code.startsWith("LEAVE_CONV-")) {
      total += amount;
      continue;
    }
    if (code.startsWith("RETRO_BASIC-") && row.thirteenthMonthEligible !== false) {
      if (serviceYear == null || row.serviceYear == null || row.serviceYear === serviceYear) total += amount;
    }
  }
  return round2(Math.max(0, total));
}

export function basicSalaryEarnedForYear(lineItems: unknown, runServiceYear: number, targetYear: number) {
  const rows = Array.isArray(lineItems) ? lineItems as PayrollLineLike[] : [];
  let total = 0;
  for (const row of rows) {
    const code = String(row.code ?? "");
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) continue;

    if (runServiceYear === targetYear && (code === "BASIC" || (code.startsWith("LEAVE-") && !code.startsWith("LEAVE_CONV-")))) {
      total += amount;
      continue;
    }
    if (code.startsWith("RETRO_BASIC-") && row.thirteenthMonthEligible !== false && row.serviceYear === targetYear) {
      total += amount;
    }
  }
  return round2(Math.max(0, total));
}

export function thirteenthMonthPaidFromLineItems(lineItems: unknown) {
  const rows = Array.isArray(lineItems) ? lineItems as PayrollLineLike[] : [];
  return round2(rows.reduce((sum, row) => {
    const code = String(row.code ?? "").toUpperCase();
    if (code !== "13TH_MONTH" && !code.startsWith("13TH_MONTH-")) return sum;
    const amount = Number(row.amount ?? 0);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0));
}

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
