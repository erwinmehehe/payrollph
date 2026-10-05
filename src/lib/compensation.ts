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
