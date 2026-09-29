import { annualize } from "@/lib/annualization";

export type FinalPayLine = { code?: string; label?: string; amount?: string | number; notes?: string[] };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function readBasicAndThirteenth(lineItems: unknown) {
  const lines = Array.isArray(lineItems) ? lineItems as FinalPayLine[] : [];
  let basic = 0;
  let thirteenthPaid = 0;
  let contributions = 0;
  let taxWithheld = 0;

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
  }

  return {
    basic: round2(basic),
    thirteenthPaid: round2(thirteenthPaid),
    contributions: round2(contributions),
    taxWithheld: round2(taxWithheld),
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
  mwe: boolean;
  leaveMonetizationPay: number;
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

  const grossForAnnualization = round2(
    Math.max(0, input.grossCompensationYtd)
      + Math.max(0, input.unpaidBasicSalary)
      + thirteenthPaidYtd
      + thirteenthDue
      + Math.max(0, input.taxableSeparationPay ?? input.separationPay)
      + Math.max(0, input.taxableRetirementPay ?? input.retirementPay)
      + Math.max(0, input.otherBenefits),
  );
  const annualized = annualize({
    grossCompensation: grossForAnnualization,
    thirteenthMonth: thirteenthPaidYtd + thirteenthDue,
    statutoryContributions: Math.max(0, input.statutoryContributionsYtd),
    taxWithheld: Math.max(0, input.taxWithheldYtd),
    mwe: input.mwe,
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
  const finalStatutoryDeductions = round2(Math.max(0, input.finalStatutoryDeductions ?? 0));
  const netFinalPay = round2(Math.max(
    0,
    grossFinalPay + taxAdjustment - finalStatutoryDeductions - Math.max(0, input.loanDeductions),
  ));

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
    leaveMonetizationPay: round2(Math.max(0, input.leaveMonetizationPay)),
    separationPay: round2(Math.max(0, input.separationPay)),
    retirementPay: round2(Math.max(0, input.retirementPay)),
    otherBenefits: round2(Math.max(0, input.otherBenefits)),
    finalStatutoryDeductions,
    loanDeductions: round2(Math.max(0, input.loanDeductions)),
    netFinalPay,
  };
}
