import { annualize } from "@/lib/annualization";
import { round2 } from "@/lib/round";

export type FinalPayLine = { code?: string; label?: string; amount?: string | number; notes?: string[] };



export function readBasicAndThirteenth(lineItems: unknown) {
  const lines = Array.isArray(lineItems) ? lineItems as FinalPayLine[] : [];
  let basic = 0;
  let thirteenthPaid = 0;
  let contributions = 0;
  let taxWithheld = 0;
  let deMinimisPaid = 0;
  let deMinimisExcess = 0;

  for (const line of lines) {
    const amount = Number(line.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const code = String(line.code ?? "").toUpperCase();
    const label = String(line.label ?? "").toLowerCase();

    // Effective-dated RETRO entries are corrections to BASIC salary from a
    // previously released cutoff, so they belong in the 13th-month base.
    if (
      code === "BASIC"
      || code.startsWith("RETRO-")
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
  const thirteenthEntitlement = round2(basicSalaryEarnedYtd / 12);
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
  const preLoanNet = round2(Math.max(
    0,
    grossFinalPay + taxAdjustment - finalStatutoryDeductions,
  ));
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
    requestedLoanDeductions,
    loanDeductions,
    deferredLoanBalance,
    netFinalPay,
  };
}
