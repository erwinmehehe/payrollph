import { computeAnnualWithholdingTax } from "@/lib/payroll-rules";
import { round2 } from "@/lib/round";

export const ANNUALIZATION_RULE_VERSION = "PH-2026.03";

/**
 * TRAIN law: 13th month pay + other benefits are exempt up to PHP 90,000.
 * Anything above the cap becomes taxable compensation.
 */
export const THIRTEENTH_MONTH_EXEMPTION_CAP = 90_000;

export const SHARED_BENEFIT_EARNING_TYPES = new Set([
  "13th_month",
  "thirteenth_month",
  "bonus",
  "christmas_bonus",
  "midyear_bonus",
  "performance_bonus",
  "other_benefit_90k",
]);

export function isSharedBenefitPoolEarningType(value: string | null | undefined) {
  return SHARED_BENEFIT_EARNING_TYPES.has(String(value ?? "").trim().toLowerCase());
}

export function sharedBenefitPoolCutoffTreatment(input: {
  priorPool: number;
  currentPool: number;
}) {
  const priorPool = round2(Math.max(0, Number(input.priorPool) || 0));
  const currentPool = round2(Math.max(0, Number(input.currentPool) || 0));
  const remainingExemption = round2(Math.max(0, THIRTEENTH_MONTH_EXEMPTION_CAP - priorPool));
  const exemptCurrent = round2(Math.min(currentPool, remainingExemption));
  const taxableCurrent = round2(Math.max(0, currentPool - exemptCurrent));
  return {
    priorPool,
    currentPool,
    remainingExemption,
    exemptCurrent,
    taxableCurrent,
    poolAfterCutoff: round2(priorPool + currentPool),
  };
}

export type AnnualizationInput = {
  /**
   * Total compensation actually received for the year, INCLUDING 13th-month
   * pay and other benefits. Annualization removes the exempt portions below;
   * taxable excess must never be added a second time.
   */
  grossCompensation: number;
  thirteenthMonth: number;
  /** Other benefits sharing the PHP 90,000 annual exemption pool. */
  otherBenefits?: number;
  /** De minimis amounts within their category ceilings, fully exempt. */
  deMinimis?: number;
  /** Excess over de minimis category ceilings; joins the PHP 90,000 pool. */
  deMinimisExcess?: number;
  statutoryContributions: number;
  taxWithheld: number;
  mwe: boolean;
  /**
   * Taxable MWE supplementary compensation outside the statutory minimum wage
   * exemptions (for example commission/service charge/other taxable allowance).
   * Do not include the 13th-month/other-benefit pool here.
   */
  mweTaxableSupplementaryCompensation?: number;
};

export type AnnualizationResult = {
  grossCompensation: number;
  thirteenthMonth: number;
  exemptThirteenthMonth: number;
  taxableThirteenthMonth: number;
  otherBenefits: number;
  deMinimis: number;
  deMinimisExcess: number;
  benefitPool: number;
  exemptBenefitPool: number;
  taxableBenefitPool: number;
  mweTaxableSupplementaryCompensation: number;
  nonTaxable: number;
  statutoryContributions: number;
  taxableIncome: number;
  taxDue: number;
  taxWithheld: number;
  adjustment: number;
  outcome: "refund" | "collect" | "balanced";
  mwe: boolean;
  ruleVersion: string;
};



/**
 * Year-end annualization (BIR substituted filing basis).
 *
 * Steps, in the order BIR Form 2316 lays them out:
 *  1. Total gross compensation for the tax year.
 *  2. Split 13th month / other benefits into exempt (<= 90k) and taxable excess.
 *  3. Subtract non-taxable items: exempt 13th month, de minimis, and the
 *     employee share of SSS / PhilHealth / Pag-IBIG.
 *  4. Apply the annual TRAIN bracket table to the remainder.
 *  5. Compare tax due against tax actually withheld across the year.
 *     Negative delta => refund to employee in December.
 *     Positive delta => collect from the December payout.
 *
 * For a Minimum Wage Earner, statutory minimum wage plus the specifically
 * enumerated holiday/overtime/night-differential/hazard pay remain exempt.
 * Other supplementary compensation and benefit-pool excess remain taxable.
 */
export function annualize(input: AnnualizationInput): AnnualizationResult {
  const grossCompensation = round2(Math.max(0, input.grossCompensation));
  const thirteenthMonth = round2(Math.max(0, input.thirteenthMonth));
  const otherBenefits = round2(Math.max(0, input.otherBenefits ?? 0));
  const deMinimis = round2(Math.max(0, input.deMinimis ?? 0));
  const deMinimisExcess = round2(Math.max(0, input.deMinimisExcess ?? 0));
  const statutoryContributions = round2(Math.max(0, input.statutoryContributions));
  const taxWithheld = round2(Math.max(0, input.taxWithheld));
  const mweTaxableSupplementaryCompensation = round2(
    Math.max(0, input.mweTaxableSupplementaryCompensation ?? 0),
  );

  // BIR treats 13th-month pay and "other benefits" as ONE PHP 90,000 annual
  // exemption pool. Excess de minimis benefits enter this same pool before
  // becoming taxable compensation.
  const benefitPool = round2(thirteenthMonth + otherBenefits + deMinimisExcess);
  const exemptBenefitPool = round2(Math.min(benefitPool, THIRTEENTH_MONTH_EXEMPTION_CAP));
  const taxableBenefitPool = round2(Math.max(0, benefitPool - exemptBenefitPool));

  // Allocate the exemption to 13th-month pay first only for explanatory output.
  // Tax is based on the combined pool above, not on this allocation.
  const exemptThirteenthMonth = round2(Math.min(thirteenthMonth, exemptBenefitPool));
  const taxableThirteenthMonth = round2(Math.max(0, thirteenthMonth - exemptThirteenthMonth));
  const nonTaxable = round2(exemptBenefitPool + deMinimis + statutoryContributions);

  const taxableIncome = input.mwe
    ? round2(Math.max(
        0,
        mweTaxableSupplementaryCompensation + taxableBenefitPool - statutoryContributions,
      ))
    : round2(Math.max(0, grossCompensation - nonTaxable));

  const taxDue = round2(computeAnnualWithholdingTax(taxableIncome, false));
  const adjustment = round2(taxDue - taxWithheld);

  return {
    grossCompensation,
    thirteenthMonth,
    exemptThirteenthMonth,
    taxableThirteenthMonth,
    otherBenefits,
    deMinimis,
    deMinimisExcess,
    benefitPool,
    exemptBenefitPool,
    taxableBenefitPool,
    mweTaxableSupplementaryCompensation,
    nonTaxable,
    statutoryContributions,
    taxableIncome,
    taxDue,
    taxWithheld,
    adjustment,
    outcome: adjustment < 0 ? "refund" : adjustment > 0 ? "collect" : "balanced",
    mwe: input.mwe,
    ruleVersion: ANNUALIZATION_RULE_VERSION,
  };
}

/** Renders a BIR 2316 style certificate as a labelled text document (draft). */
export function renderForm2316(input: {
  taxYear: number;
  employerName: string;
  employerTin?: string;
  employeeName: string;
  employeeNo: string;
  employeeTin?: string;
  result: AnnualizationResult;
}) {
  const money = (value: number) =>
    value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const r = input.result;
  const line = (label: string, value: string) => `${label.padEnd(56, ".")} ${value.padStart(16)}`;

  return [
    "BIR FORM NO. 2316 (DRAFT - NOT A CERTIFIED SUBMISSION)",
    "Certificate of Compensation Payment / Tax Withheld",
    `For the Year Ended December 31, ${input.taxYear}`,
    "",
    `Employer .......... ${input.employerName}`,
    `Employer TIN ...... ${input.employerTin ?? "(not on file)"}`,
    `Employee .......... ${input.employeeName} (${input.employeeNo})`,
    `Employee TIN ...... ${input.employeeTin ?? "(not on file)"}`,
    `MWE status ........ ${r.mwe ? "Minimum Wage Earner - statutory wage/premiums exempt" : "Not an MWE"}`,
    "",
    "PART IV-A  SUMMARY",
    line("Gross compensation income", money(r.grossCompensation)),
    line("13th month pay", money(r.thirteenthMonth)),
    line("Other benefits in 90,000 pool", money(r.otherBenefits + r.deMinimisExcess)),
    line("  Combined exempt benefits (cap 90,000.00)", money(r.exemptBenefitPool)),
    line("  Combined taxable benefit excess", money(r.taxableBenefitPool)),
    line("De minimis benefits within category ceilings", money(r.deMinimis)),
    line("SSS / PhilHealth / Pag-IBIG (employee share)", money(r.statutoryContributions)),
    line("Total non-taxable / exempt", money(r.nonTaxable)),
    "",
    line("NET TAXABLE COMPENSATION INCOME", money(r.taxableIncome)),
    line("Tax due (TRAIN annual brackets)", money(r.taxDue)),
    line("Tax withheld January to December", money(r.taxWithheld)),
    line(
      r.outcome === "refund" ? "REFUND TO EMPLOYEE" : r.outcome === "collect" ? "COLLECT FROM EMPLOYEE" : "BALANCED",
      money(Math.abs(r.adjustment)),
    ),
    "",
    `Rule version: ${r.ruleVersion}`,
    "Draft only. Validate through the BIR Alphalist Data Entry and Validation Module",
    "before treating this as a submission-ready certificate.",
  ].join("\n");
}
