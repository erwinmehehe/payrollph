import { annualize } from "@/lib/annualization";
import { round2 } from "@/lib/round";
import { storedMoneyCentavos, verifiedPesosFromCentavos } from "@/lib/stored-money-centavos";
import { thirteenthMonthFromCentavos } from "./thirteenth-month-centavos";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { finalPaySignedBalance } from "./final-pay-signed-balance";

export type FinalPayLine = { code?: string; label?: string; amount?: string | number; notes?: string[] };

/** Year of the original released payroll cutoff, not the later retro payout. */
export type RetroSourceAttribution = {
  taxYear: number;
  sourceYearByAdjustmentId: ReadonlyMap<number, number | null>;
};

/** A malformed, impossible or cross-year source cutoff needs payroll review, not a guessed year. */
export function retroSourceTaxYear(periodStart: string, periodEnd: string): number | null {
  const validDate = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const utc = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(utc.getTime()) && utc.toISOString().slice(0, 10) === date;
  };
  if (!validDate(periodStart) || !validDate(periodEnd)
    || periodStart > periodEnd || periodStart.slice(0, 4) !== periodEnd.slice(0, 4)) return null;
  return Number(periodEnd.slice(0, 4));
}



export function readBasicAndThirteenth(lineItems: unknown, attribution?: RetroSourceAttribution) {
  const lines = Array.isArray(lineItems) ? lineItems as FinalPayLine[] : [];
  let basic = 0;
  let thirteenthPaid = 0;
  let contributions = 0;
  let taxWithheld = 0;
  let deMinimisPaid = 0;
  let deMinimisExcess = 0;

  for (const line of lines) {
    const code = String(line.code ?? "").toUpperCase();
    const amount = Number(line.amount ?? 0);
    // A malformed retro amount must not silently vanish from final-pay
    // 13th-month reconciliation. Existing non-retro tolerances are unchanged.
    if (code.startsWith("RETRO-") && (line.amount == null
      || (typeof line.amount !== "number" && typeof line.amount !== "string")
      || String(line.amount).trim() === "" || !Number.isFinite(amount))) {
      throw new Error("FINAL_PAY_RETRO_AMOUNT_INVALID: Review the settled payroll adjustment " + code + ".");
    }
    if (!Number.isFinite(amount)) continue;
    const label = String(line.label ?? "").toLowerCase();

    // A retro settlement paid in this tax year can correct BASIC pay earned
    // in a previous calendar year. Attribute it to the original released
    // cutoff; do not inflate the 13th-month base for the settlement year.
    let eligibleRetroBasic = false;
    if (code.startsWith("RETRO-")) {
      const match = /^RETRO-(\d+)$/.exec(code);
      const originalYear = match && attribution
        ? attribution.sourceYearByAdjustmentId.get(Number(match[1]))
        : undefined;
      if (!Number.isInteger(originalYear) || !Number.isInteger(attribution?.taxYear)) {
        throw new Error(
          "FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED: Reconcile the original payroll cutoff for " +
          code + " before calculating 13th-month final pay.",
        );
      }
      eligibleRetroBasic = originalYear === attribution!.taxYear;
    }
    // M-5: HOLIDAY_UNWORKED is holiday pay, not an ordinary BASIC wage
    // line. DOLE's statutory 13th-month minimum generally excludes holiday
    // pay. An employer whose agreement or established practice integrates
    // it into basic salary needs separate reviewed policy evidence; never
    // silently interpret this line as BASIC or change past entitlements here.
    if (
      code === "BASIC"
      || eligibleRetroBasic
      || (code.startsWith("LEAVE-") && !code.startsWith("LEAVE_CONV-"))
      || code === "LATE"
      || code === "UT"
    ) basic += amount;
    if (code.includes("13TH") || code.includes("THIRTEENTH") || label.includes("13th month") || label.includes("thirteenth month")) {
      thirteenthPaid += Math.max(0, amount);
    }
    if (["SSS", "PHIC", "HDMF", "PAGIBIG", "PAG-IBIG"].includes(code)) contributions += -amount;
    if (code === "WHT" || code === "TAX" || label.includes("withholding tax")) taxWithheld += Math.abs(amount);
    if (code.startsWith("DM-")) {
      deMinimisPaid += Math.max(0, amount);
      const note = (line.notes ?? []).find((item) =>
        /(?:other-benefits pool|taxable) excess this period/i.test(String(item))
      );
      const match = note ? String(note).match(/₱?([\d,.]+)\s*$/) : null;
      if (match) deMinimisExcess += Number(match[1].replace(/,/g, "")) || 0;
    }
  }

  return {
    basic: round2(basic),
    thirteenthPaid: round2(thirteenthPaid),
    contributions: round2(contributions),
    taxWithheld: round2(taxWithheld),
    deMinimisPaid: round2(deMinimisPaid),
    deMinimisExcess: round2(deMinimisExcess),
  };
}

/**
 * Actual SIL/convertible-leave encashment used by the Separation API.
 * Daily rate is already resolved from the employee's governed pay basis.
 * This is a gross benefit; tax treatment must still be reviewed separately.
 */
export function calculateLeaveMonetizationPay(unusedLeaveCredits: number, dailyRate: number): number {
  if (!Number.isFinite(unusedLeaveCredits) || unusedLeaveCredits < 0) {
    throw new Error("Convertible unused leave credits must be a finite non-negative number.");
  }
  if (!Number.isFinite(dailyRate) || dailyRate <= 0) {
    throw new Error("Daily pay rate must be a positive finite number.");
  }
  const amount = unusedLeaveCredits * dailyRate;
  if (!Number.isFinite(amount) || amount > 1_000_000_000) {
    throw new Error("Convertible leave calculation exceeds the supported monetary range.");
  }
  return round2(amount);
}

export function finalPayDueDate(lastDay: string) {
  const date = new Date(`${lastDay}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("Last day must be a valid YYYY-MM-DD date.");
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

export function computeFinalPay(input: {
  releasedBasicYtd: number;
  historicalBasicYtd: number;
  unpaidBasicSalary: number;
  thirteenthPaidYtd: number;
  grossCompensationYtd: number;
  deMinimisYtd?: number;
  deMinimisExcessYtd?: number;
  statutoryContributionsYtd: number;
  taxWithheldYtd: number;
  mwe: boolean;
  mweTaxableSupplementaryCompensationYtd?: number;
  leaveMonetizationPay: number;
  taxableLeaveMonetizationPay?: number;
  separationPay: number;
  retirementPay: number;
  taxableSeparationPay?: number;
  taxableRetirementPay?: number;
  otherBenefits: number;
  finalStatutoryDeductions?: number;
  loanDeductions: number;
}) {
  const basicSalaryEarnedYtd = round2(
    Math.max(0, input.releasedBasicYtd)
      + Math.max(0, input.historicalBasicYtd)
      + Math.max(0, input.unpaidBasicSalary),
  );
  const thirteenthEntitlement = criticalReleaseFlagEnabled("exactThirteenthCentavos")
    ? thirteenthMonthFromCentavos(basicSalaryEarnedYtd) : round2(basicSalaryEarnedYtd / 12);
  const thirteenthPaidYtd = round2(Math.max(0, input.thirteenthPaidYtd));
  const thirteenthDue = round2(Math.max(0, thirteenthEntitlement - thirteenthPaidYtd));

  const finalStatutoryDeductions = round2(Math.max(0, input.finalStatutoryDeductions ?? 0));
  const grossForAnnualization = round2(
    Math.max(0, input.grossCompensationYtd)
      + Math.max(0, input.unpaidBasicSalary)
      + thirteenthPaidYtd
      + thirteenthDue
      + Math.max(0, input.taxableLeaveMonetizationPay ?? input.leaveMonetizationPay)
      + Math.max(0, input.taxableSeparationPay ?? input.separationPay)
      + Math.max(0, input.taxableRetirementPay ?? input.retirementPay)
      + Math.max(0, input.otherBenefits),
  );
  const finalTaxableSupplementaryCompensation = round2(
    Math.max(0, input.taxableLeaveMonetizationPay ?? input.leaveMonetizationPay)
      + Math.max(0, input.taxableSeparationPay ?? input.separationPay)
      + Math.max(0, input.taxableRetirementPay ?? input.retirementPay),
  );
  const annualized = annualize({
    grossCompensation: grossForAnnualization,
    thirteenthMonth: thirteenthPaidYtd + thirteenthDue,
    otherBenefits: Math.max(0, input.otherBenefits),
    deMinimis: Math.max(0, input.deMinimisYtd ?? 0),
    deMinimisExcess: Math.max(0, input.deMinimisExcessYtd ?? 0),
    statutoryContributions: Math.max(0, input.statutoryContributionsYtd) + finalStatutoryDeductions,
    taxWithheld: Math.max(0, input.taxWithheldYtd),
    mwe: input.mwe,
    mweTaxableSupplementaryCompensation:
      Math.max(0, input.mweTaxableSupplementaryCompensationYtd ?? 0)
      + finalTaxableSupplementaryCompensation,
  });

  // annualize().adjustment is taxDue - taxWithheld:
  // negative means refund (addition), positive means collection (deduction).
  const taxAdjustment = round2(-annualized.adjustment);
  const grossFinalPay = round2(
    Math.max(0, input.unpaidBasicSalary)
      + thirteenthDue
      + Math.max(0, input.leaveMonetizationPay)
      + Math.max(0, input.separationPay)
      + Math.max(0, input.retirementPay)
      + Math.max(0, input.otherBenefits),
  );
  // Mandatory collection can exceed the payable final-pay balance. Never
  // silently discard the difference when net pay is floored to zero.
  // Tax-first allocation is an auditable *provisional* accounting order, not
  // a legal conclusion; packages with any shortfall are blocked from approval
  // until a Philippine payroll reviewer reconciles the liabilities.
  const availableBeforeMandatoryDeductions = round2(
    grossFinalPay + Math.max(0, taxAdjustment),
  );
  const requestedTaxCollection = round2(Math.max(0, -taxAdjustment));
  const appliedTaxCollection = round2(Math.min(availableBeforeMandatoryDeductions, requestedTaxCollection));
  const unpaidTaxWithholding = round2(Math.max(0, requestedTaxCollection - appliedTaxCollection));
  const remainingAfterTax = round2(Math.max(0, availableBeforeMandatoryDeductions - appliedTaxCollection));
  const appliedStatutoryDeductions = round2(Math.min(remainingAfterTax, finalStatutoryDeductions));
  const unpaidStatutoryDeductions = round2(Math.max(0, finalStatutoryDeductions - appliedStatutoryDeductions));
  const unpaidMandatoryDeductions = round2(unpaidTaxWithholding + unpaidStatutoryDeductions);
  const preLoanNet = round2(Math.max(0, remainingAfterTax - appliedStatutoryDeductions));
  const requestedLoanDeductions = round2(Math.max(0, input.loanDeductions));
  const loanDeductions = round2(Math.min(preLoanNet, requestedLoanDeductions));
  const deferredLoanBalance = round2(Math.max(0, requestedLoanDeductions - loanDeductions));
  const netFinalPay = round2(Math.max(0, preLoanNet - loanDeductions));

  return {
    basicSalaryEarnedYtd,
    thirteenthEntitlement,
    thirteenthPaidYtd,
    thirteenthDue,
    grossFinalPay,
    taxAdjustment,
    taxOutcome: annualized.outcome,
    taxDue: annualized.taxDue,
    taxWithheldYtd: annualized.taxWithheld,
    annualization: annualized,
    leaveMonetizationPay: round2(Math.max(0, input.leaveMonetizationPay)),
    separationPay: round2(Math.max(0, input.separationPay)),
    retirementPay: round2(Math.max(0, input.retirementPay)),
    otherBenefits: round2(Math.max(0, input.otherBenefits)),
    finalStatutoryDeductions,
    availableBeforeMandatoryDeductions,
    requestedTaxCollection,
    appliedTaxCollection,
    unpaidTaxWithholding,
    appliedStatutoryDeductions,
    unpaidStatutoryDeductions,
    unpaidMandatoryDeductions,
    requestedLoanDeductions,
    loanDeductions,
    deferredLoanBalance,
    netFinalPay,
    ...(criticalReleaseFlagEnabled("finalPaySignedReview") ? { signedNetFinalPay: finalPaySignedBalance({ grossFinalPay, taxAdjustment, finalStatutoryDeductions, loanDeductions }) } : {}),
  };
}


/**
 * Source-of-truth release preflight for both new and legacy separation records.
 * Do not rely solely on optional JSON snapshots: historical rows may predate
 * shortfall evidence. Non-finite/negative mandatory source values fail closed.
 */
export function unresolvedFinalPayMandatoryShortfall(input: {
  grossFinalPay: unknown;
  taxAdjustment: unknown;
  finalStatutoryDeductions: unknown;
}): number | null {
  const grossCents = storedMoneyCentavos(input.grossFinalPay);
  const taxCents = storedMoneyCentavos(input.taxAdjustment);
  const statutoryCents = storedMoneyCentavos(input.finalStatutoryDeductions);
  if (grossCents === null || taxCents === null || statutoryCents === null
    || grossCents < 0 || statutoryCents < 0) return null;
  // Use exact centavo integers; also reject overflow in intermediate sums.
  const shortfallCents = statutoryCents - grossCents - taxCents;
  if (!Number.isSafeInteger(shortfallCents)) return null;
  return verifiedPesosFromCentavos(Math.max(0, shortfallCents));
}
