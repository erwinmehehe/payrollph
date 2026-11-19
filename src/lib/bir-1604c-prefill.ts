/**
 * Present-employer BIR 1604-C field SUGGESTIONS derived from a year-end annualization result.
 *
 * The review template (bir-1604c-source-review.ts) fills only nine fields per employee and leaves about thirty empty for a
 * person to key in. A few of those follow EXACTLY from the annualization formula, and this module suggests only those:
 *
 *   nonTaxable = exemptBenefitPool + deMinimis + statutoryContributions        (annualize(): nonTaxable)
 *   non-MWE:  taxableIncome = max(0, grossCompensation - nonTaxable)           (annualize(): taxableIncome)
 *
 * It NEVER guesses: a category split that the year-end row does not carry (basic salary versus allowances, commission,
 * overtime, MWE holiday / overtime / night / hazard premiums, previous-employer amounts) is left out and listed in
 * `stillManual`. Nothing is zero-filled except where the identity above proves the amount is nil. If an identity fails
 * the module suggests nothing and reports why.
 *
 * Field correspondence: the D1 / D2 present-employer field order mirrors BIR Form 2316 items 34, 35, 36, 37, 38 (non-taxable)
 * and 48 and 52 (taxable). That correspondence is INFERRED FROM FIELD ORDER, not from the RMC 25-2024 Annex A text, so every
 * suggestion is only a suggestion: a reviewer confirms it, and the official BIR Alphalist module remains the authority.
 *
 * This module is pure. It reads nothing, writes nothing, is wired into no route, and does not produce a DAT file.
 */
import type { AnnualizationResult } from "./annualization";
import { BIR_1604C_D1_FIELDS, BIR_1604C_D2_FIELDS } from "./bir-1604c-dat-candidate";

export type Bir1604cPrefillInput = Pick<AnnualizationResult,
  "mwe" | "grossCompensation" | "exemptBenefitPool" | "taxableBenefitPool" | "deMinimis"
  | "statutoryContributions" | "nonTaxable" | "taxableIncome">;

export type Bir1604cPrefill = {
  schedule: "D1" | "D2";
  /** Field name to a DAT-ready amount string (two decimals). Empty when an identity failed. */
  suggestions: Record<string, string>;
  /** Field name to how it was derived, so a reviewer can see the basis. */
  sources: Record<string, string>;
  /** Why nothing was suggested. */
  issues: string[];
  /** Body fields that are neither suggested here nor already filled by the review template. */
  stillManual: string[];
};

// Fields the review template already fills from verified sources (see buildBir1604cReviewTemplate).
const TEMPLATE_VERIFIED = new Set([
  "TIN", "BRANCH_CODE", "LAST_NAME", "FIRST_NAME", "MIDDLE_NAME", "NATIONALITY",
  "NET_TAXABLE_COMP_INCOME", "TAX_DUE", "ACTUAL_AMT_WTHLD",
]);
const COMMON_FIELD_COUNT = 12;

const centavos = (value: number) => {
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  return Number.isFinite(value) && value >= 0 && Math.abs(scaled - rounded) < 1e-6 && Number.isSafeInteger(rounded)
    ? rounded : null;
};
const amount = (cents: number) => (cents / 100).toFixed(2);

export function prefillBir1604cPresentEmployer(input: Bir1604cPrefillInput): Bir1604cPrefill {
  const schedule = input.mwe ? "D2" as const : "D1" as const;
  const fieldList: readonly string[] = schedule === "D1" ? BIR_1604C_D1_FIELDS : BIR_1604C_D2_FIELDS;
  const body = fieldList.slice(COMMON_FIELD_COUNT);
  const issues: string[] = [];
  const suggestions: Record<string, string> = {};
  const sources: Record<string, string> = {};

  const pool = centavos(input.exemptBenefitPool);
  const taxablePool = centavos(input.taxableBenefitPool);
  const deMinimis = centavos(input.deMinimis);
  const contributions = centavos(input.statutoryContributions);
  const nonTaxable = centavos(input.nonTaxable);
  const gross = centavos(input.grossCompensation);
  const taxable = centavos(input.taxableIncome);
  if ([pool, taxablePool, deMinimis, contributions, nonTaxable, gross, taxable].some((value) => value === null)) {
    issues.push("INVALID_OR_MISSING_AMOUNT: every year-end amount must be a finite, non-negative centavo value.");
  } else if (pool! + deMinimis! + contributions! !== nonTaxable!) {
    issues.push("NON_TAXABLE_IDENTITY_FAILED: exempt benefit pool + de minimis + contributions must equal the non-taxable total.");
  } else if (!input.mwe && Math.max(0, gross! - nonTaxable!) !== taxable!) {
    issues.push("TAXABLE_IDENTITY_FAILED: for an ordinary taxpayer, taxable income must equal gross compensation minus non-taxable.");
  }

  if (issues.length === 0) {
    const put = (field: string, cents: number, source: string) => {
      if (!fieldList.includes(field)) throw new Error("Field " + field + " is not part of the " + schedule + " layout.");
      suggestions[field] = amount(cents);
      sources[field] = source;
    };
    // Valid for both schedules: these are exactly the annualization pool, de minimis and contribution lines.
    put("PRES_NONTAX_13TH_MONTH", pool!, "annualization exemptBenefitPool (2316 item 34, capped at 90,000)");
    put("PRES_NONTAX_DE_MINIMIS", deMinimis!, "annualization deMinimis (2316 item 35)");
    put("PRES_NONTAX_SSS_ETC", contributions!, "annualization statutoryContributions (2316 item 36)");
    put("PRES_TAXABLE_13TH_MONTH", taxablePool!, "annualization taxableBenefitPool (2316 item 48)");
    if (!input.mwe) {
      // An ordinary taxpayer has no exempt basic salary and annualization recognises no other exempt item, so the
      // identity above proves these are nil; the total exempt and total taxable lines follow from the same identity.
      put("NONTAX_BASIC_SAL", 0, "identity: an ordinary taxpayer has no exempt basic salary");
      put("PRES_NONTAX_SALARIES", 0, "identity: non-taxable = pool + de minimis + contributions leaves nothing else exempt");
      put("PRES_TOTAL_NONTAX_COMP_INCOME", nonTaxable!, "annualization nonTaxable (2316 item 38)");
      put("PRES_TOTAL_COMP", taxable!, "annualization taxableIncome = gross - non-taxable (2316 item 52)");
    }
  }

  const stillManual = body.filter((field) => !TEMPLATE_VERIFIED.has(field) && !(field in suggestions));
  return { schedule, suggestions, sources, issues, stillManual };
}

/**
 * Merge suggestions into a review-template record. A suggestion fills only an EMPTY field; it never overwrites a value a
 * reviewer already entered, and a differing reviewer value is reported as a conflict instead of being replaced.
 */
export function applyBir1604cPrefill(
  fields: Record<string, string | number | null | undefined>,
  prefill: Pick<Bir1604cPrefill, "suggestions">,
) {
  const merged = { ...fields };
  const applied: string[] = [];
  const conflicts: string[] = [];
  for (const [field, suggested] of Object.entries(prefill.suggestions)) {
    const existing = merged[field];
    if (existing === null || existing === undefined || existing === "") {
      merged[field] = suggested;
      applied.push(field);
    } else if (Number(existing) !== Number(suggested)) {
      conflicts.push(field);
    }
  }
  return { fields: merged, applied, conflicts };
}
