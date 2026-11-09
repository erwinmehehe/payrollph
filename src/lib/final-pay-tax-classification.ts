/**
 * Reviewed Philippine final-pay tax allocations. These functions calculate
 * amounts; they do not independently establish legal entitlement or replace
 * the Separation maker/checker and document review controls.
 *
 * BIR RR 29-2025, effective 2026-01-06: private-sector monetized unused
 * vacation leave is de minimis for up to 12 days in the year (previously 10).
 * RMC 50-2018: amounts above a de minimis ceiling join the 13th-month / other
 * benefits PHP 90,000 pool rather than becoming automatically taxable.
 * NIRC section 32(B)(6)(b), RMO 26-2011 / RMO 66-2016: qualifying
 * involuntary separation payments are excluded from gross income.
 */

export const PRIVATE_VACATION_LEAVE_INCREASE_EFFECTIVE = "2026-01-06";

const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(value + "T00:00:00Z").getTime()) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

function cents(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001 ||
      !Number.isSafeInteger(Math.round(value * 100))) {
    throw new Error(label + " must be a non-negative amount in exact centavos.");
  }
  return Math.round(value * 100);
}

function tenths(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      Math.abs(value * 10 - Math.round(value * 10)) > 0.000001 ||
      !Number.isSafeInteger(Math.round(value * 10))) {
    throw new Error(label + " must be a finite non-negative number in tenths of a day.");
  }
  return Math.round(value * 10);
}

function evidence(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 200) {
    throw new Error(label + " requires an 8-200 character supporting evidence reference.");
  }
  return value.trim();
}

export function privateVacationLeaveExemptDaysForDate(taxDate: string): number {
  if (!validDate(taxDate)) throw new Error("Leave tax treatment date is invalid.");
  return taxDate >= PRIVATE_VACATION_LEAVE_INCREASE_EFFECTIVE ? 12 : 10;
}

export type ReviewedLeaveTaxAllocation = {
  basis: "private_vacation_de_minimis";
  taxDate: string;
  annualExemptDayLimit: number;
  annualExemptDaysPreviouslyUsed: number;
  exemptDaysThisPay: number;
  grossPay: number;
  deMinimisPay: number;
  benefitsPoolPay: number;
  directTaxablePay: 0;
  evidenceReference: string;
};

/**
 * This explicitly reviewed private vacation-leave path never guesses that
 * sick/SIL/miscellaneous leave is vacation leave. Previous exempt conversions
 * are taken from the existing organization/employee leave ledger.
 */
export function classifyPrivateVacationLeave(input: {
  taxDate: string;
  leaveType: string;
  days: number;
  dailyRate: number;
  annualExemptDaysPreviouslyUsed: number;
  evidenceReference: string;
}): ReviewedLeaveTaxAllocation {
  if (!/^(vacation leave|vacation)$/i.test(input.leaveType.trim())) {
    throw new Error("Private vacation-leave de minimis applies only to verified unused vacation leave.");
  }
  const reference = evidence(input.evidenceReference, "Leave tax classification");
  const dayTenths = tenths(input.days, "Monetized vacation leave");
  const previousTenths = tenths(input.annualExemptDaysPreviouslyUsed, "Prior exempt leave");
  if (dayTenths <= 0 || dayTenths > 3660 ||
      typeof input.dailyRate !== "number" || !Number.isFinite(input.dailyRate) || input.dailyRate <= 0) {
    throw new Error("Vacation-leave amount and daily rate must be valid and positive.");
  }
  const annualExemptDayLimit = privateVacationLeaveExemptDaysForDate(input.taxDate);
  const exemptTenths = Math.max(0, Math.min(dayTenths, annualExemptDayLimit * 10 - previousTenths));
  // Monetary split is calculated once in integer centavos; the excess is the
  // exact remainder, avoiding losing a centavo on fractional daily rates.
  const totalCents = Math.round(input.days * input.dailyRate * 100);
  const exemptCents = exemptTenths === dayTenths
    ? totalCents
    : Math.round((exemptTenths / 10) * input.dailyRate * 100);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 ||
      !Number.isSafeInteger(exemptCents) || exemptCents > totalCents) {
    throw new Error("Vacation-leave tax allocation is not centavo-safe.");
  }
  return {
    basis: "private_vacation_de_minimis",
    taxDate: input.taxDate,
    annualExemptDayLimit,
    annualExemptDaysPreviouslyUsed: previousTenths / 10,
    exemptDaysThisPay: exemptTenths / 10,
    grossPay: totalCents / 100,
    deMinimisPay: exemptCents / 100,
    benefitsPoolPay: (totalCents - exemptCents) / 100,
    directTaxablePay: 0,
    evidenceReference: reference,
  };
}

export const SEPARATION_EXEMPTION_REASONS = [
  "death", "sickness", "disability", "redundancy", "retrenchment",
  "closure", "other_beyond_control",
] as const;

export type ReviewedSeparationTaxAllocation = {
  grossPay: number;
  taxablePay: number;
  exemptPay: number;
  exemptionReason: typeof SEPARATION_EXEMPTION_REASONS[number] | null;
  evidenceReference: string | null;
};

/**
 * A partial exemption is supported, but requires an actual qualifying cause
 * and evidence. A bare "exempt" checkbox is not sufficient legal proof.
 */
export function classifyReviewedSeparationPay(input: {
  separationPay: number;
  taxableAmount?: unknown;
  exemptionReason?: unknown;
  evidenceReference?: unknown;
  separationType: string;
}): ReviewedSeparationTaxAllocation {
  const grossCents = cents(input.separationPay, "Separation pay");
  const taxableCents = input.taxableAmount === undefined
    ? grossCents : cents(input.taxableAmount, "Taxable separation pay");
  if (taxableCents > grossCents) throw new Error("Taxable separation pay cannot exceed the actual payout.");
  const exemptCents = grossCents - taxableCents;
  if (exemptCents === 0) {
    if (input.exemptionReason != null && input.exemptionReason !== "") {
      throw new Error("Exemption reason is only permitted when part of separation pay is exempt.");
    }
    return {
      grossPay: grossCents / 100, taxablePay: taxableCents / 100,
      exemptPay: 0, exemptionReason: null, evidenceReference: null,
    };
  }
  if (input.separationType !== "authorized_cause") {
    throw new Error("An exempt separation component requires a documented authorized-cause exit; other exits need specialist review.");
  }
  if (!SEPARATION_EXEMPTION_REASONS.includes(
    input.exemptionReason as typeof SEPARATION_EXEMPTION_REASONS[number],
  )) {
    throw new Error("A recognized involuntary separation exemption reason is required.");
  }
  const reference = evidence(input.evidenceReference, "Separation exemption");
  return {
    grossPay: grossCents / 100,
    taxablePay: taxableCents / 100,
    exemptPay: exemptCents / 100,
    exemptionReason: input.exemptionReason as typeof SEPARATION_EXEMPTION_REASONS[number],
    evidenceReference: reference,
  };
}
