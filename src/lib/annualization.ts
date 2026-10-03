import { computeAnnualWithholdingTax } from "@/lib/payroll-rules";

export const ANNUALIZATION_RULE_VERSION = "PH-2026.02";

/**
 * TRAIN law: 13th month pay + other benefits are exempt up to PHP 90,000.
 * Anything above the cap becomes taxable compensation.
 */
export const THIRTEENTH_MONTH_EXEMPTION_CAP = 90_000;

export type AnnualizationInput = {
  /** Total compensation already includes 13th-month and other-benefit amounts. */
  grossCompensation: number;
  thirteenthMonth: number;
  /** Other benefits that share the PHP 90,000 annual exemption with 13th month. */
  otherBenefits?: number;
  statutoryContributions: number;
  taxWithheld: number;
  mwe: boolean;
  /** Benefits that remain de minimis after category ceilings are applied. */
  deMinimis?: number;
  /** Statutory minimum wage plus qualifying MWE holiday/OT/NSD/hazard pay. */
  mweExemptCompensation?: number;
};

export type AnnualizationResult = {
  grossCompensation: number;
  thirteenthMonth: number;
  otherBenefits: number;
  combinedOtherBenefits: number;
  exemptThirteenthMonth: number;
  exemptOtherBenefits: number;
  exemptCombinedOtherBenefits: number;
  taxableThirteenthMonth: number;
  taxableOtherBenefits: number;
  taxableCombinedOtherBenefits: number;
  deMinimis: number;
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

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

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
 * For a Minimum Wage Earner, only statutory minimum wage and qualifying
 * holiday/overtime/night-differential/hazard components are exempt. Other
 * taxable compensation remains subject to the annual TRAIN brackets.
 */
export function annualize(input: AnnualizationInput): AnnualizationResult {
  const grossCompensation = round2(Math.max(0, input.grossCompensation));
  const thirteenthMonth = round2(Math.max(0, input.thirteenthMonth));
  const otherBenefits = round2(Math.max(0, input.otherBenefits ?? 0));
  const combinedOtherBenefits = round2(thirteenthMonth + otherBenefits);
  const deMinimis = round2(Math.max(0, input.deMinimis ?? 0));
  const statutoryContributions = round2(Math.max(0, input.statutoryContributions));
  const taxWithheld = round2(Math.max(0, input.taxWithheld));
  const mweExemptCompensation = round2(Math.max(0, input.mweExemptCompensation ?? 0));

  const exemptCombinedOtherBenefits = round2(
    Math.min(combinedOtherBenefits, THIRTEENTH_MONTH_EXEMPTION_CAP),
  );
  const exemptThirteenthMonth = round2(Math.min(thirteenthMonth, exemptCombinedOtherBenefits));
  const exemptOtherBenefits = round2(Math.max(0, exemptCombinedOtherBenefits - exemptThirteenthMonth));
  const taxableThirteenthMonth = round2(Math.max(0, thirteenthMonth - exemptThirteenthMonth));
  const taxableOtherBenefits = round2(Math.max(0, otherBenefits - exemptOtherBenefits));
  const taxableCombinedOtherBenefits = round2(taxableThirteenthMonth + taxableOtherBenefits);
  const nonTaxable = round2(
    exemptCombinedOtherBenefits
      + deMinimis
      + statutoryContributions
      + (input.mwe ? mweExemptCompensation : 0),
  );

  // grossCompensation already contains 13th-month and other-benefit amounts.
  // Their taxable excess stays in gross; subtract the exempt portion once.
  const taxableIncome = round2(Math.max(0, grossCompensation - nonTaxable));

  const taxDue = round2(computeAnnualWithholdingTax(taxableIncome, false));
  const adjustment = round2(taxDue - taxWithheld);

  return {
    grossCompensation,
    thirteenthMonth,
    otherBenefits,
    combinedOtherBenefits,
    exemptThirteenthMonth,
    exemptOtherBenefits,
    exemptCombinedOtherBenefits,
    taxableThirteenthMonth,
    taxableOtherBenefits,
    taxableCombinedOtherBenefits,
    deMinimis,
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
    line("Other benefits sharing the 90,000 pool", money(r.otherBenefits)),
    line("Combined 13th month + other benefits", money(r.combinedOtherBenefits)),
    line("  Exempt combined portion (cap 90,000.00)", money(r.exemptCombinedOtherBenefits)),
    line("  Taxable combined excess", money(r.taxableCombinedOtherBenefits)),
    line("De minimis benefits", money(r.deMinimis)),
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
