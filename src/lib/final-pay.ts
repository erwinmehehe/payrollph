import { annualize, type AnnualizationResult } from "@/lib/annualization";

type LineItem = {
  code?: string;
  label?: string;
  amount?: number | string;
  nonTaxableAmount?: number | string;
  taxableAmount?: number | string;
};

export type ReleasedPayrollEntry = {
  grossPay: number | string;
  lineItems: unknown;
};

export type PayrollTaxComponentSummary = {
  grossCompensation: number;
  basicCompensation: number;
  statutoryContributions: number;
  taxWithheld: number;
  thirteenthMonthPaid: number;
  deMinimis: number;
  otherBenefits90kPool: number;
  otherNonTaxable: number;
  mweExemptCompensation: number;
};

export type FinalPayDraftInput = {
  entries: ReleasedPayrollEntry[];
  monthlyBasic: number;
  annualPayDivisor: number;
  unusedLeaveCredits: number;
  loanDeductions: number;
  mwe: boolean;
  previousEmployerTaxableCompensation?: number;
  previousEmployerTaxWithheld?: number;
  additionalTaxablePay?: number;
  additionalNonTaxablePay?: number;
};

export type FinalPayDraft = {
  basicEarnedYtd: number;
  ytdGrossCompensation: number;
  ytdStatutoryContributions: number;
  ytdTaxWithheld: number;
  thirteenthMonthPaidYtd: number;
  prorated13thAccrued: number;
  prorated13thDue: number;
  annualPayDivisor: number;
  dailyRate: number;
  unusedLeaveCredits: number;
  leaveMonetizationPay: number;
  leaveExemptDays: number;
  leaveExemptAmount: number;
  leaveOtherBenefitsAmount: number;
  previousEmployerTaxableCompensation: number;
  previousEmployerTaxWithheld: number;
  additionalTaxablePay: number;
  additionalNonTaxablePay: number;
  grossFinalPayBeforeTaxAndLoans: number;
  loanDeductions: number;
  taxCashEffect: number;
  amountDueFromEmployee: number;
  netFinalPay: number;
  tax: AnnualizationResult;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const nonNegative = (value: number | undefined) => round2(Math.max(0, Number(value ?? 0) || 0));

export function summarizePayrollTaxComponents(entries: ReleasedPayrollEntry[]): PayrollTaxComponentSummary {
  let grossCompensation = 0;
  let basicCompensation = 0;
  let statutoryContributions = 0;
  let taxWithheld = 0;
  let thirteenthMonthPaid = 0;
  let deMinimis = 0;
  let otherBenefits90kPool = 0;
  let otherNonTaxable = 0;
  let mweExemptCompensation = 0;

  for (const entry of entries) {
    const gross = Number(entry.grossPay);
    if (Number.isFinite(gross)) grossCompensation += gross;

    const items = Array.isArray(entry.lineItems) ? entry.lineItems as LineItem[] : [];
    for (const item of items) {
      const signed = Number(item.amount ?? 0);
      if (!Number.isFinite(signed)) continue;
      const amount = Math.abs(signed);
      const code = String(item.code ?? "").toUpperCase();
      const label = `${item.code ?? ""} ${item.label ?? ""}`.toLowerCase();

      if (["SSS", "PHIC", "HDMF"].includes(code)
        || label.includes("sss contribution")
        || label.includes("philhealth contribution")
        || label.includes("pag-ibig contribution")
        || label.includes("pagibig contribution")) {
        statutoryContributions += amount;
      } else if (code === "WHT" || label.includes("withholding tax")) {
        taxWithheld += amount;
      }

      if (code === "BASIC") basicCompensation += Math.max(0, signed);
      if (code === "LATE" || code === "UT") basicCompensation += Math.min(0, signed);

      if (code === "13TH" || code === "THIRTEENTH" || label.includes("13th month") || label.includes("thirteenth month")) {
        thirteenthMonthPaid += Math.max(0, signed);
      }

      if (["BASIC", "OT", "ND", "HOLIDAY"].includes(code)) {
        mweExemptCompensation += Math.max(0, signed);
      }
      if (code === "LATE" || code === "UT") {
        mweExemptCompensation += Math.min(0, signed);
      }

      if (code.startsWith("EXP-")) {
        otherNonTaxable += Math.max(0, signed);
      }

      if (code.startsWith("DM-")) {
        const nonTaxable = Number(item.nonTaxableAmount);
        const taxable = Number(item.taxableAmount);
        if (Number.isFinite(nonTaxable)) deMinimis += Math.max(0, nonTaxable);
        if (Number.isFinite(taxable)) otherBenefits90kPool += Math.max(0, taxable);
      }
    }
  }

  return {
    grossCompensation: round2(Math.max(0, grossCompensation)),
    basicCompensation: round2(Math.max(0, basicCompensation)),
    statutoryContributions: round2(Math.max(0, statutoryContributions)),
    taxWithheld: round2(Math.max(0, taxWithheld)),
    thirteenthMonthPaid: round2(Math.max(0, thirteenthMonthPaid)),
    deMinimis: round2(Math.max(0, deMinimis)),
    otherBenefits90kPool: round2(Math.max(0, otherBenefits90kPool)),
    otherNonTaxable: round2(Math.max(0, otherNonTaxable)),
    mweExemptCompensation: round2(Math.max(0, mweExemptCompensation)),
  };
}

export function computeFinalPayDraft(input: FinalPayDraftInput): FinalPayDraft {
  const summary = summarizePayrollTaxComponents(input.entries);
  const monthlyBasic = nonNegative(input.monthlyBasic);
  const annualPayDivisor = Math.max(1, nonNegative(input.annualPayDivisor) || 365);
  const unusedLeaveCredits = nonNegative(input.unusedLeaveCredits);
  const loanDeductions = nonNegative(input.loanDeductions);
  const previousEmployerTaxableCompensation = nonNegative(input.previousEmployerTaxableCompensation);
  const previousEmployerTaxWithheld = nonNegative(input.previousEmployerTaxWithheld);
  const additionalTaxablePay = nonNegative(input.additionalTaxablePay);
  const additionalNonTaxablePay = nonNegative(input.additionalNonTaxablePay);

  const prorated13thAccrued = round2(summary.basicCompensation / 12);
  const prorated13thDue = round2(Math.max(0, prorated13thAccrued - summary.thirteenthMonthPaid));

  const dailyRate = round2((monthlyBasic * 12) / annualPayDivisor);
  const leaveMonetizationPay = round2(unusedLeaveCredits * ((monthlyBasic * 12) / annualPayDivisor));
  const leaveExemptDays = round2(Math.min(10, unusedLeaveCredits));
  const leaveExemptAmount = round2(Math.min(leaveMonetizationPay, leaveExemptDays * ((monthlyBasic * 12) / annualPayDivisor)));
  const leaveOtherBenefitsAmount = round2(Math.max(0, leaveMonetizationPay - leaveExemptAmount));

  const grossFinalPayBeforeTaxAndLoans = round2(
    prorated13thDue
      + leaveMonetizationPay
      + additionalTaxablePay
      + additionalNonTaxablePay,
  );

  const tax = annualize({
    grossCompensation: round2(
      summary.grossCompensation
        + prorated13thDue
        + leaveMonetizationPay
        + additionalTaxablePay
        + additionalNonTaxablePay
        + previousEmployerTaxableCompensation,
    ),
    thirteenthMonth: round2(summary.thirteenthMonthPaid + prorated13thDue),
    statutoryContributions: summary.statutoryContributions,
    taxWithheld: round2(summary.taxWithheld + previousEmployerTaxWithheld),
    mwe: input.mwe,
    deMinimis: round2(summary.deMinimis + leaveExemptAmount),
    otherBenefits90kPool: round2(summary.otherBenefits90kPool + leaveOtherBenefitsAmount),
    otherNonTaxable: round2(summary.otherNonTaxable + additionalNonTaxablePay),
    mweExemptCompensation: summary.mweExemptCompensation,
  });

  // annualize.adjustment is positive when more tax must be collected and
  // negative when the employee is due a refund. Final-pay cash flow uses the
  // opposite sign: positive adds a refund; negative deducts a collection.
  const taxCashEffect = round2(-tax.adjustment);
  const rawNetFinalPay = round2(grossFinalPayBeforeTaxAndLoans + taxCashEffect - loanDeductions);
  const amountDueFromEmployee = round2(Math.max(0, -rawNetFinalPay));
  const netFinalPay = round2(Math.max(0, rawNetFinalPay));

  return {
    basicEarnedYtd: summary.basicCompensation,
    ytdGrossCompensation: summary.grossCompensation,
    ytdStatutoryContributions: summary.statutoryContributions,
    ytdTaxWithheld: summary.taxWithheld,
    thirteenthMonthPaidYtd: summary.thirteenthMonthPaid,
    prorated13thAccrued,
    prorated13thDue,
    annualPayDivisor,
    dailyRate,
    unusedLeaveCredits,
    leaveMonetizationPay,
    leaveExemptDays,
    leaveExemptAmount,
    leaveOtherBenefitsAmount,
    previousEmployerTaxableCompensation,
    previousEmployerTaxWithheld,
    additionalTaxablePay,
    additionalNonTaxablePay,
    grossFinalPayBeforeTaxAndLoans,
    loanDeductions,
    taxCashEffect,
    amountDueFromEmployee,
    netFinalPay,
    tax,
  };
}
