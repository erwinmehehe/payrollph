export const PAY_BASES = ["monthly", "daily", "hourly"] as const;
export type PayBasis = (typeof PAY_BASES)[number];

export type EmployeePayProfileInput = {
  payBasis: string;
  rateAmount: string | number;
  standardWorkDaysPerMonth: string | number;
  standardHoursPerDay: string | number;
};

export type ResolvedPayProfile = {
  payBasis: PayBasis;
  rateAmount: number;
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
  monthlyEquivalent: number;
  dailyRate: number;
  hourlyRate: number;
};

function positive(value: string | number, label: string, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${label} must be greater than 0 and no more than ${max}.`);
  }
  return parsed;
}

export function resolvePayProfile(input: EmployeePayProfileInput): ResolvedPayProfile {
  const basis = String(input.payBasis ?? "").trim().toLowerCase();
  if (!PAY_BASES.includes(basis as PayBasis)) {
    throw new Error("Employee pay basis must be Monthly salaried, Daily paid, or Hourly paid.");
  }

  const payBasis = basis as PayBasis;
  const rateAmount = positive(input.rateAmount, "Pay rate", 100_000_000);
  const standardWorkDaysPerMonth = positive(input.standardWorkDaysPerMonth, "Standard work days per month", 31);
  const standardHoursPerDay = positive(input.standardHoursPerDay, "Standard hours per day", 24);

  const monthlyEquivalent =
    payBasis === "monthly"
      ? rateAmount
      : payBasis === "daily"
        ? rateAmount * standardWorkDaysPerMonth
        : rateAmount * standardHoursPerDay * standardWorkDaysPerMonth;

  const dailyRate =
    payBasis === "monthly"
      ? rateAmount / standardWorkDaysPerMonth
      : payBasis === "daily"
        ? rateAmount
        : rateAmount * standardHoursPerDay;

  const hourlyRate =
    payBasis === "hourly"
      ? rateAmount
      : dailyRate / standardHoursPerDay;

  return {
    payBasis,
    rateAmount,
    standardWorkDaysPerMonth,
    standardHoursPerDay,
    monthlyEquivalent,
    dailyRate,
    hourlyRate,
  };
}

export function basicPayForCutoff(profile: ResolvedPayProfile, regularMinutes: number) {
  if (!Number.isFinite(regularMinutes) || regularMinutes < 0) {
    throw new Error("Regular minutes must be zero or greater.");
  }
  if (profile.payBasis === "monthly") return profile.rateAmount / 2;
  const regularHours = regularMinutes / 60;
  if (profile.payBasis === "daily") {
    return (regularHours / profile.standardHoursPerDay) * profile.rateAmount;
  }
  return regularHours * profile.rateAmount;
}

export function attendanceDeductionsForCutoff(
  profile: ResolvedPayProfile,
  tardinessMinutes: number,
  undertimeMinutes: number,
) {
  if (profile.payBasis !== "monthly") {
    return { tardinessDeduction: 0, undertimeDeduction: 0 };
  }
  return {
    tardinessDeduction: (Math.max(0, tardinessMinutes) / 60) * profile.hourlyRate,
    undertimeDeduction: (Math.max(0, undertimeMinutes) / 60) * profile.hourlyRate,
  };
}

export function leaveAdjustmentForCutoff(input: {
  profile: ResolvedPayProfile;
  paidDays: number;
  unpaidDays: number;
}) {
  const paidDays = Math.max(0, input.paidDays);
  const unpaidDays = Math.max(0, input.unpaidDays);
  const { profile } = input;

  if (profile.payBasis === "monthly") {
    const adjustment = -(unpaidDays * profile.dailyRate);
    return adjustment === 0 ? 0 : adjustment;
  }
  if (profile.payBasis === "daily") {
    return paidDays * profile.dailyRate;
  }
  return paidDays * profile.standardHoursPerDay * profile.hourlyRate;
}

export function payBasisLabel(payBasis: string) {
  if (payBasis === "monthly") return "Monthly salaried";
  if (payBasis === "daily") return "Daily paid";
  if (payBasis === "hourly") return "Hourly paid";
  return "Unconfigured";
}


export type EffectivePayRevisionInput = {
  effectiveDate: string;
  previousPayBasis: string;
  previousRateAmount: string | number;
  previousStandardWorkDaysPerMonth: string | number;
  previousStandardHoursPerDay: string | number;
  newPayBasis: string;
  newRateAmount: string | number;
  newStandardWorkDaysPerMonth: string | number;
  newStandardHoursPerDay: string | number;
  reason?: string;
};

export type PayTimelineSegment = {
  startDate: string;
  endDate: string;
  profile: ResolvedPayProfile;
  source: "current" | "revision";
  reason?: string;
};

function dateValue(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid payroll date: ${value}`);
  return parsed;
}

function isoDate(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  return isoDate(dateValue(value) + days * 86_400_000);
}

function daysInclusive(startDate: string, endDate: string) {
  return Math.floor((dateValue(endDate) - dateValue(startDate)) / 86_400_000) + 1;
}

export function resolvePayTimeline(input: {
  currentProfile: EmployeePayProfileInput;
  revisions: EffectivePayRevisionInput[];
  periodStart: string;
  periodEnd: string;
}) {
  const periodStart = input.periodStart;
  const periodEnd = input.periodEnd;
  if (dateValue(periodEnd) < dateValue(periodStart)) throw new Error("Payroll period end must not precede period start.");

  const revisions = [...input.revisions]
    .filter((revision) => dateValue(revision.effectiveDate) <= dateValue(periodEnd))
    .sort((a, b) => dateValue(a.effectiveDate) - dateValue(b.effectiveDate));

  let startingProfile: ResolvedPayProfile | null = null;
  const beforeOrAtStart = revisions.filter((revision) => dateValue(revision.effectiveDate) <= dateValue(periodStart));
  if (beforeOrAtStart.length > 0) {
    const latest = beforeOrAtStart[beforeOrAtStart.length - 1];
    startingProfile = resolvePayProfile({
      payBasis: latest.newPayBasis,
      rateAmount: latest.newRateAmount,
      standardWorkDaysPerMonth: latest.newStandardWorkDaysPerMonth,
      standardHoursPerDay: latest.newStandardHoursPerDay,
    });
  } else {
    const firstInPeriod = revisions.find((revision) => dateValue(revision.effectiveDate) > dateValue(periodStart));
    if (firstInPeriod) {
      startingProfile = resolvePayProfile({
        payBasis: firstInPeriod.previousPayBasis,
        rateAmount: firstInPeriod.previousRateAmount,
        standardWorkDaysPerMonth: firstInPeriod.previousStandardWorkDaysPerMonth,
        standardHoursPerDay: firstInPeriod.previousStandardHoursPerDay,
      });
    }
  }
  startingProfile ??= resolvePayProfile(input.currentProfile);

  const changes = revisions.filter((revision) =>
    dateValue(revision.effectiveDate) > dateValue(periodStart)
    && dateValue(revision.effectiveDate) <= dateValue(periodEnd)
  );

  const segments: PayTimelineSegment[] = [];
  let cursor = periodStart;
  let active = startingProfile;
  let source: PayTimelineSegment["source"] = "current";
  let reason: string | undefined;

  for (const revision of changes) {
    const priorEnd = addDays(revision.effectiveDate, -1);
    if (dateValue(priorEnd) >= dateValue(cursor)) {
      segments.push({ startDate: cursor, endDate: priorEnd, profile: active, source, reason });
    }
    active = resolvePayProfile({
      payBasis: revision.newPayBasis,
      rateAmount: revision.newRateAmount,
      standardWorkDaysPerMonth: revision.newStandardWorkDaysPerMonth,
      standardHoursPerDay: revision.newStandardHoursPerDay,
    });
    cursor = revision.effectiveDate;
    source = "revision";
    reason = revision.reason;
  }

  segments.push({ startDate: cursor, endDate: periodEnd, profile: active, source, reason });
  return segments;
}

export function profileForDate(timeline: PayTimelineSegment[], workDate: string) {
  const match = timeline.find((segment) =>
    dateValue(workDate) >= dateValue(segment.startDate)
    && dateValue(workDate) <= dateValue(segment.endDate)
  );
  if (!match) throw new Error(`No pay profile covers ${workDate}.`);
  return match.profile;
}

/**
 * Resolves the payroll-grade pay profile for one historical or future work date.
 *
 * The current profile alone is not historical evidence: after a raise it holds
 * the new rate. If the requested date predates the first revision, the first
 * revision's previous profile is authoritative. Otherwise the latest revision
 * effective on/before the date wins.
 */
export function effectivePayProfileForDate(input: {
  currentProfile: EmployeePayProfileInput;
  revisions: EffectivePayRevisionInput[];
  workDate: string;
}) {
  const workDateValue = dateValue(input.workDate);
  const revisions = [...input.revisions].sort(
    (a, b) => dateValue(a.effectiveDate) - dateValue(b.effectiveDate),
  );

  const effective = revisions.filter(
    (revision) => dateValue(revision.effectiveDate) <= workDateValue,
  ).at(-1);
  if (effective) {
    return resolvePayProfile({
      payBasis: effective.newPayBasis,
      rateAmount: effective.newRateAmount,
      standardWorkDaysPerMonth: effective.newStandardWorkDaysPerMonth,
      standardHoursPerDay: effective.newStandardHoursPerDay,
    });
  }

  const next = revisions.find(
    (revision) => dateValue(revision.effectiveDate) > workDateValue,
  );
  if (next) {
    return resolvePayProfile({
      payBasis: next.previousPayBasis,
      rateAmount: next.previousRateAmount,
      standardWorkDaysPerMonth: next.previousStandardWorkDaysPerMonth,
      standardHoursPerDay: next.previousStandardHoursPerDay,
    });
  }

  return resolvePayProfile(input.currentProfile);
}

export function fixedMonthlyBasicForTimeline(
  timeline: PayTimelineSegment[],
  periodStart: string,
  periodEnd: string,
  employmentStart?: string | null,
  employmentEnd?: string | null,
) {
  const totalDays = daysInclusive(periodStart, periodEnd);
  const activeStart =
    employmentStart && dateValue(employmentStart) > dateValue(periodStart)
      ? employmentStart
      : periodStart;
  const activeEnd =
    employmentEnd && dateValue(employmentEnd) < dateValue(periodEnd)
      ? employmentEnd
      : periodEnd;

  if (dateValue(activeEnd) < dateValue(activeStart)) return 0;

  return timeline.reduce((sum, segment) => {
    if (segment.profile.payBasis !== "monthly") return sum;
    const segmentStart =
      dateValue(segment.startDate) > dateValue(activeStart)
        ? segment.startDate
        : activeStart;
    const segmentEnd =
      dateValue(segment.endDate) < dateValue(activeEnd)
        ? segment.endDate
        : activeEnd;
    if (dateValue(segmentEnd) < dateValue(segmentStart)) return sum;

    const coveredDays = daysInclusive(segmentStart, segmentEnd);
    return sum + (segment.profile.rateAmount / 2) * (coveredDays / totalDays);
  }, 0);
}

export function payTimelineTrace(timeline: PayTimelineSegment[]) {
  return timeline.map((segment) =>
    `${segment.startDate}..${segment.endDate}:${segment.profile.payBasis}@${segment.profile.rateAmount.toFixed(2)}`
  );
}


export function monthlyRetroForReleasedCutoff(input: {
  previousMonthlyRate: number;
  newMonthlyRate: number;
  effectiveDate: string;
  periodStart: string;
  periodEnd: string;
}) {
  if (!Number.isFinite(input.previousMonthlyRate) || !Number.isFinite(input.newMonthlyRate)) {
    throw new Error("Retro pay rates must be valid numbers.");
  }
  if (dateValue(input.periodEnd) < dateValue(input.periodStart)) {
    throw new Error("Retro payroll period is invalid.");
  }
  if (dateValue(input.effectiveDate) > dateValue(input.periodEnd)) return 0;

  const affectedStart =
    dateValue(input.effectiveDate) > dateValue(input.periodStart)
      ? input.effectiveDate
      : input.periodStart;
  const totalDays = daysInclusive(input.periodStart, input.periodEnd);
  const affectedDays = daysInclusive(affectedStart, input.periodEnd);
  const fullCutoffDelta = (input.newMonthlyRate - input.previousMonthlyRate) / 2;
  return Math.round((fullCutoffDelta * (affectedDays / totalDays) + Number.EPSILON) * 100) / 100;
}
