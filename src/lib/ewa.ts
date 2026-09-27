import { computePagIbig, computePhilHealth, computeSss } from "@/lib/payroll-rules";
import { round2 } from "@/lib/round";

export const EWA_ADVANCE_RATE = 0.5;
export const EWA_FEE = 0;

export type EwaInput = {
  monthlyBasic: number;
  daysWorked: number;
  /** Days already advanced this period that have not yet been repaid via payroll. */
  annualPayDivisor?: number;
  statutoryDeductionFactor?: number;
  existingAdvances?: number;
  requested?: number;
  status?: string;
  hasPendingRequest?: boolean;
};

export type EwaResult = {
  dailyRate: number;
  accruedGross: number;
  statutoryDeductions: number;
  accruedNet: number;
  maxAdvance: number;
  fee: number;
  disbursable: number;
  eligible: boolean;
  reasons: string[];
};

/**
 * Earned Wage Access — lets an employee draw part of wages already earned
 * before payday.
 *
 * Accrued net = (daily rate x days worked) - the proportion of employee-share
 * SSS / PhilHealth / Pag-IBIG earned so far. Withholding tax is excluded on
 * purpose: it is only final at year-end, so advancing against a pre-tax figure
 * would over-advance. The advance is capped at 50% of accrued net and is
 * recovered as a payroll deduction on the next run.
 */
export function computeEwa(input: EwaInput): EwaResult {
  const reasons: string[] = [];
  const monthlyBasic = Number(input.monthlyBasic) || 0;
  const daysWorked = Math.max(0, Number(input.daysWorked) || 0);
  const existing = Math.max(0, Number(input.existingAdvances ?? 0));
  const requested = Math.max(0, Number(input.requested ?? 0));

  const annualPayDivisor = Number(input.annualPayDivisor ?? 365);
  const safeDivisor = Number.isFinite(annualPayDivisor) && annualPayDivisor >= 200 && annualPayDivisor <= 400 ? annualPayDivisor : 365;
  const dailyRate = monthlyBasic * 12 / safeDivisor;
  const accruedGross = round2(dailyRate * daysWorked);

  const monthlyContrib =
    computeSss(monthlyBasic).employee +
    computePhilHealth(monthlyBasic).employee +
    computePagIbig(monthlyBasic).employee;
  const cutoffFactor = Math.min(1, Math.max(0, Number(input.statutoryDeductionFactor ?? 0.5)));
  const periodShare = monthlyContrib * cutoffFactor;
  const statutoryDeductions = round2(periodShare * Math.min(1, daysWorked / 11));

  const accruedNet = round2(Math.max(0, accruedGross - statutoryDeductions));
  const maxAdvance = round2(Math.max(0, accruedNet * EWA_ADVANCE_RATE - existing));
  const fee = requested > 0 ? EWA_FEE : 0;

  let disbursable = 0;
  let eligible = true;

  if (input.status && input.status !== "Active") {
    eligible = false;
    reasons.push("Only active employees can request an advance.");
  }
  if (daysWorked <= 0) {
    eligible = false;
    reasons.push("No earned days in the current period yet.");
  }
  if (accruedNet <= 0) {
    eligible = false;
    reasons.push("No net wages accrued.");
  }
  if (input.hasPendingRequest) {
    eligible = false;
    reasons.push("A request is already pending.");
  }
  if (requested > maxAdvance) {
    eligible = false;
    reasons.push(`Requested amount exceeds the ${Math.round(EWA_ADVANCE_RATE * 100)}% cap of ${maxAdvance.toFixed(2)}.`);
  }

  if (eligible && requested > 0) disbursable = round2(requested + fee);

  return {
    dailyRate: round2(dailyRate),
    accruedGross,
    statutoryDeductions,
    accruedNet,
    maxAdvance,
    fee,
    disbursable,
    eligible,
    reasons,
  };
}
