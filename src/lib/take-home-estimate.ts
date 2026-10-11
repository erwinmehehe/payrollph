import {
  computeMonthlyWithholdingTax,
  computePagIbig,
  computePhilHealth,
  computeSss,
} from "@/lib/payroll-rules";

export type TakeHomeInput = {
  monthlyBasic: number;
  /** Taxable recurring allowances (e.g. transportation, COLA treated as taxable). */
  taxableAllowances?: number;
  /** De minimis benefits within BIR ceilings; not taxed and not counted for contributions. */
  nonTaxableAllowances?: number;
  /** Voluntary Pag-IBIG savings above the mandatory share; not tax-deductible. */
  voluntaryPagIbig?: number;
  mwe?: boolean;
  asOf?: string;
};

export type TakeHomeEstimate = {
  monthlyBasic: number;
  taxableAllowances: number;
  nonTaxableAllowances: number;
  gross: number;
  sss: number;
  philHealth: number;
  pagIbig: number;
  voluntaryPagIbig: number;
  taxableCompensation: number;
  withholdingTax: number;
  totalDeductions: number;
  netPay: number;
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function amount(value: number | undefined, label: string) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000_000) {
    throw new RangeError(`${label} must be between 0 and 100,000,000.`);
  }
  return cents(parsed);
}

/**
 * Monthly take-home estimate using the same statutory functions as payroll:
 * SSS on total remuneration, PhilHealth on basic salary only, Pag-IBIG with the
 * 1%/2% employee tier, and withholding tax on compensation after mandatory
 * employee contributions. Minimum wage earners are taxed only on supplementary
 * taxable pay. It excludes attendance, overtime, loans and one-off items.
 */
export function estimateMonthlyTakeHome(input: TakeHomeInput): TakeHomeEstimate {
  const monthlyBasic = amount(input.monthlyBasic, "Monthly basic salary");
  const taxableAllowances = amount(input.taxableAllowances, "Taxable allowances");
  const nonTaxableAllowances = amount(input.nonTaxableAllowances, "Non-taxable allowances");
  const voluntaryPagIbig = amount(input.voluntaryPagIbig, "Voluntary Pag-IBIG");
  const asOf = input.asOf ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

  const remuneration = monthlyBasic + taxableAllowances;
  const sss = computeSss(remuneration, asOf).employee;
  const philHealth = computePhilHealth(monthlyBasic, asOf).employee;
  const pagIbig = computePagIbig(remuneration, asOf).employee;
  const contributions = sss + philHealth + pagIbig;

  const taxableCompensation = cents(Math.max(0, (input.mwe ? taxableAllowances : remuneration) - contributions));
  const withholdingTax = computeMonthlyWithholdingTax(taxableCompensation, false, asOf);

  const gross = cents(remuneration + nonTaxableAllowances);
  const totalDeductions = cents(contributions + voluntaryPagIbig + withholdingTax);
  return {
    monthlyBasic,
    taxableAllowances,
    nonTaxableAllowances,
    gross,
    sss,
    philHealth,
    pagIbig,
    voluntaryPagIbig,
    taxableCompensation,
    withholdingTax,
    totalDeductions,
    netPay: cents(gross - totalDeductions),
  };
}
