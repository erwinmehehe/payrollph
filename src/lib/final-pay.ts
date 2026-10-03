import { annualize } from "@/lib/annualization";

export type FinalPayLine = {
  code?: string;
  label?: string;
  amount?: string | number;
  notes?: string[];
  periodOtherBenefitsPool?: number;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function readBasicAndThirteenth(lineItems: unknown) {
  const lines = Array.isArray(lineItems) ? lineItems as FinalPayLine[] : [];
  let basic = 0;
  let thirteenthPaid = 0;
  let contributions = 0;
  let taxWithheld = 0;
  let reimbursements = 0;
  let deMinimisExempt = 0;
  let otherBenefitsPool = 0;
  let mweExemptCompensation = 0;

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
    if (["SSS", "PHIC", "HDMF", "PAGIBIG", "PAG-IBIG"].includes(code)) contributions += Math.abs(amount);
    if (code === "WHT" || code === "TAX" || label.includes("withholding tax")) taxWithheld += Math.abs(amount);

    if (code.startsWith("EXP-")) reimbursements += Math.max(0, amount);
    if (code.startsWith("DM-")) {
      const pool = Math.max(0, Number(line.periodOtherBenefitsPool ?? 0));
      otherBenefitsPool += pool;
      deMinimisExempt += Math.max(0, amount - pool);
    }
    if (
      code === "BASIC"
      || code === "OT"
      || code === "ND"
      || code === "HOLIDAY"
      || code === "HOLIDAY_UNWORKED"
      || code === "CALAMITY"
      || code.startsWith("RETRO-")
      || (code.startsWith("LEAVE-") && !code.startsWith("LEAVE_CONV-"))
      || code === "LATE"
      || code === "UT"
    ) {
      mweExemptCompensation += amount;
    }
  }

  return {
    basic: round2(basic),
    thirteenthPaid: round2(thirteenthPaid),
    contributions: round2(contributions),
    taxWithheld: round2(taxWithheld),
    reimbursements: round2(reimbursements),
    deMinimisExempt: round2(deMinimisExempt),
    otherBenefitsPool: round2(otherBenefitsPool),
    mweExemptCompensation: round2(Math.max(0, mweExemptCompensation)),
  };
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
  statutoryContributionsYtd: number;
  taxWithheldYtd: number;
  deMinimisYtd?: number;
  otherBenefitsYtd?: number;
  mweExemptCompensationYtd?: number;
  mwe: boolean;
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
  const annualized = annualize({
    grossCompensation: grossForAnnualization,
    thirteenthMonth: thirteenthPaidYtd + thirteenthDue,
    otherBenefits: Math.max(0, input.otherBenefitsYtd ?? 0) + Math.max(0, input.otherBenefits),
    deMinimis: Math.max(0, input.deMinimisYtd ?? 0),
    statutoryContributions: Math.max(0, input.statutoryContributionsYtd) + finalStatutoryDeductions,
    taxWithheld: Math.max(0, input.taxWithheldYtd),
    mwe: input.mwe,
    mweExemptCompensation: input.mwe
      ? Math.max(0, input.mweExemptCompensationYtd ?? 0) + Math.max(0, input.unpaidBasicSalary)
      : 0,
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
