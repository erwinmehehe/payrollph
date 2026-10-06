export type PayBasis = "monthly" | "daily" | "hourly";

export function annualizePay(input: {
  payBasis: string;
  rateAmount: number;
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
}) {
  const rate = Number(input.rateAmount);
  const days = Number(input.standardWorkDaysPerMonth);
  const hours = Number(input.standardHoursPerDay);
  if (![rate, days, hours].every(Number.isFinite) || rate < 0 || days <= 0 || hours <= 0) {
    throw new Error("A valid pay rate, workdays per month and hours per day are required.");
  }
  if (input.payBasis === "monthly") return round2(rate * 12);
  if (input.payBasis === "daily") return round2(rate * days * 12);
  if (input.payBasis === "hourly") return round2(rate * hours * days * 12);
  throw new Error("Unsupported pay basis.");
}

export function rateFromAnnual(input: {
  payBasis: string;
  annualSalary: number;
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
}) {
  const annual = Number(input.annualSalary);
  const days = Number(input.standardWorkDaysPerMonth);
  const hours = Number(input.standardHoursPerDay);
  if (![annual, days, hours].every(Number.isFinite) || annual < 0 || days <= 0 || hours <= 0) {
    throw new Error("A valid annual salary, workdays per month and hours per day are required.");
  }
  if (input.payBasis === "monthly") return round2(annual / 12);
  if (input.payBasis === "daily") return round2(annual / (days * 12));
  if (input.payBasis === "hourly") return round2(annual / (hours * days * 12));
  throw new Error("Unsupported pay basis.");
}

export function compaRatio(annualSalary: number, midpointAnnual: number) {
  const salary = Number(annualSalary);
  const midpoint = Number(midpointAnnual);
  if (!Number.isFinite(salary) || !Number.isFinite(midpoint) || midpoint <= 0) return null;
  return Math.round((salary / midpoint) * 10000) / 100;
}

export function validateBand(input: { minimumAnnual: number; midpointAnnual: number; maximumAnnual: number }) {
  const minimum = Number(input.minimumAnnual);
  const midpoint = Number(input.midpointAnnual);
  const maximum = Number(input.maximumAnnual);
  if (![minimum, midpoint, maximum].every(Number.isFinite) || minimum < 0) {
    return { ok: false as const, error: "Band values must be valid non-negative amounts." };
  }
  if (!(minimum <= midpoint && midpoint <= maximum) || maximum <= 0) {
    return { ok: false as const, error: "Salary band must satisfy minimum ≤ midpoint ≤ maximum." };
  }
  return { ok: true as const };
}

export function proposalBudgetDelta(currentAnnual: number, proposedAnnual: number) {
  const current = Number(currentAnnual);
  const proposed = Number(proposedAnnual);
  if (![current, proposed].every(Number.isFinite)) throw new Error("Valid current and proposed annual pay are required.");
  return round2(proposed - current);
}

export function proposalWithinBand(proposedAnnual: number, minimumAnnual: number, maximumAnnual: number) {
  const proposed = Number(proposedAnnual);
  return Number.isFinite(proposed)
    && proposed >= Number(minimumAnnual)
    && proposed <= Number(maximumAnnual);
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type CompensationBandScope = {
  id: number;
  jobProfileId: number | null;
  gradeId: number | null;
  legalEntityId: number | null;
  locationCode: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  active: boolean;
};

export function bandIsEffective(
  band: CompensationBandScope,
  effectiveDate: string,
) {
  return band.active
    && band.effectiveFrom <= effectiveDate
    && (!band.effectiveUntil || band.effectiveUntil >= effectiveDate);
}

export function selectCompensationBand<T extends CompensationBandScope>(
  bands: T[],
  input: {
    effectiveDate: string;
    jobProfileId: number | null;
    gradeId: number | null;
    legalEntityId: number | null;
    locationCode?: string | null;
  },
) {
  const location = String(input.locationCode ?? "PH").trim().toUpperCase() || "PH";
  const eligible = bands.filter((band) => {
    if (!bandIsEffective(band, input.effectiveDate)) return false;
    const roleMatch =
      (band.jobProfileId != null && band.jobProfileId === input.jobProfileId)
      || (band.jobProfileId == null && band.gradeId != null && band.gradeId === input.gradeId);
    if (!roleMatch) return false;
    if (band.legalEntityId != null && band.legalEntityId !== input.legalEntityId) return false;
    return band.locationCode === location || band.locationCode === "PH";
  });

  return eligible.sort((a, b) => {
    const profileSpecificity = Number(b.jobProfileId != null) - Number(a.jobProfileId != null);
    if (profileSpecificity) return profileSpecificity;
    const employerSpecificity = Number(b.legalEntityId != null) - Number(a.legalEntityId != null);
    if (employerSpecificity) return employerSpecificity;
    const locationSpecificity = Number(b.locationCode === location) - Number(a.locationCode === location);
    if (locationSpecificity) return locationSpecificity;
    return b.effectiveFrom.localeCompare(a.effectiveFrom);
  })[0] ?? null;
}

function isoDayValue(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid compensation date: ${value}`);
  return parsed;
}

function daysInclusive(startDate: string, endDate: string) {
  return Math.floor((isoDayValue(endDate) - isoDayValue(startDate)) / 86_400_000) + 1;
}

export function recurringComponentAmountForCutoff(input: {
  amount: number;
  amountFrequency: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  periodStart: string;
  periodEnd: string;
}) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Recurring compensation amount must be zero or greater.");
  if (!["monthly", "per_cutoff"].includes(input.amountFrequency)) {
    throw new Error("Recurring compensation frequency must be monthly or per_cutoff.");
  }
  if (isoDayValue(input.periodEnd) < isoDayValue(input.periodStart)) {
    throw new Error("Payroll cutoff end cannot precede its start.");
  }

  const overlapStart =
    isoDayValue(input.effectiveFrom) > isoDayValue(input.periodStart)
      ? input.effectiveFrom
      : input.periodStart;
  const overlapEnd =
    input.effectiveUntil && isoDayValue(input.effectiveUntil) < isoDayValue(input.periodEnd)
      ? input.effectiveUntil
      : input.periodEnd;

  if (isoDayValue(overlapEnd) < isoDayValue(overlapStart)) return 0;

  const cutoffDays = daysInclusive(input.periodStart, input.periodEnd);
  const activeDays = daysInclusive(overlapStart, overlapEnd);
  const fullCutoffAmount = input.amountFrequency === "monthly" ? amount / 2 : amount;
  return round2(fullCutoffAmount * (activeDays / cutoffDays));
}

export function rangePosition(
  annualSalary: number,
  minimumAnnual: number,
  maximumAnnual: number,
) {
  const salary = Number(annualSalary);
  const minimum = Number(minimumAnnual);
  const maximum = Number(maximumAnnual);
  if (![salary, minimum, maximum].every(Number.isFinite) || maximum <= minimum) return null;
  return Math.round(((salary - minimum) / (maximum - minimum)) * 10000) / 100;
}
