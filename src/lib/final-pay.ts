import { THIRTEENTH_MONTH_EXEMPTION_CAP } from "@/lib/annualization";
import { computeAnnualWithholdingTax } from "@/lib/payroll-rules";

export type FinalPayHistoryEntry = {
  grossPay: string | number;
  lineItems?: unknown;
  trace?: unknown;
};

export type FinalPayResult = {
  releasedPeriods: number;
  ytdGross: number;
  ytdTaxable: number;
  ytdTaxWithheld: number;
  basicSalaryEarnedYtd: number;
  thirteenthPaidYtd: number;
  thirteenthMonth: {
    gross: number;
    exempt: number;
    taxable: number;
  };
  leaveConversion: {
    amount: number;
    treatment: "taxable" | "non_taxable";
  };
  annualTaxable: number;
  annualTax: number;
  taxToWithhold: number;
  taxRefund: number;
  taxSettlement: number;
  otherDeductions: number;
  grossFinalPay: number;
  netFinalPay: number;
  amountDueFromEmployee: number;
  warnings: string[];
};

type LineItem = { code?: string; label?: string; amount?: string | number };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amountOf = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function itemsOf(entry: FinalPayHistoryEntry) {
  return Array.isArray(entry.lineItems) ? (entry.lineItems as LineItem[]) : [];
}

function taxableFromTrace(trace: unknown) {
  if (!trace || typeof trace !== "object") return null;
  const inputs = (trace as Record<string, unknown>).inputs;
  if (!Array.isArray(inputs)) return null;

  const row = inputs.find(
    (value): value is string =>
      typeof value === "string" && value.trim().toLowerCase().startsWith("taxablecompensation="),
  );
  if (!row) return null;

  const parsed = Number(row.split("=").slice(1).join("=").replace(/[₱,s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isBasic(item: LineItem) {
  const text = `${item.code ?? ""} ${item.label ?? ""}`.toLowerCase();
  return text.includes("basic");
}

function isThirteenthMonth(item: LineItem) {
  const text = `${item.code ?? ""} ${item.label ?? ""}`.toLowerCase();
  return text.includes("13th") || text.includes("thirteenth");
}

function isWithholding(item: LineItem) {
  const text = `${item.code ?? ""} ${item.label ?? ""}`.toLowerCase();
  return item.code?.toUpperCase() === "WHT" || text.includes("withholding");
}

export function summarizeFinalPayHistory(entries: FinalPayHistoryEntry[]) {
  let gross = 0;
  let taxable = 0;
  let taxWithheld = 0;
  let basic = 0;
  let thirteenthPaid = 0;
  let missingTaxableTrace = 0;

  for (const entry of entries) {
    gross += amountOf(entry.grossPay);
    const items = itemsOf(entry);

    basic += items
      .filter(isBasic)
      .reduce((sum, item) => sum + Math.max(0, amountOf(item.amount)), 0);

    taxWithheld += items
      .filter(isWithholding)
      .reduce((sum, item) => sum + Math.abs(amountOf(item.amount)), 0);

    thirteenthPaid += items
      .filter(isThirteenthMonth)
      .reduce((sum, item) => sum + Math.max(0, amountOf(item.amount)), 0);

    const traced = taxableFromTrace(entry.trace);
    if (traced === null) {
      missingTaxableTrace += 1;
    } else {
      taxable += traced;
    }
  }

  return {
    periods: entries.length,
    gross: round2(gross),
    taxable: round2(taxable),
    taxWithheld: round2(taxWithheld),
    basicSalaryEarned: round2(basic),
    thirteenthPaid: round2(thirteenthPaid),
    missingTaxableTrace,
  };
}

/**
 * Final-pay annualization based on the employee's released payroll history.
 *
 * The formula intentionally mirrors the uploaded Payroll Copilot implementation:
 * YTD taxable compensation + taxable final-pay items are annualized, prior
 * withholding is credited, and the result is either additional withholding or
 * a refund. The 13th-month exemption shares the PHP 90,000 statutory cap with
 * other benefits supplied by the caller.
 */
export function calculateFinalPay(input: {
  history: FinalPayHistoryEntry[];
  unpaidBasic?: number;
  otherTaxableEarnings?: number;
  nonTaxableEarnings?: number;
  otherBenefitsUsingExemption?: number;
  unusedLeaveConversion?: number;
  unusedLeaveTaxTreatment?: "taxable" | "non_taxable";
  otherDeductions?: number;
  priorEmployerTaxable?: number;
  priorEmployerTaxWithheld?: number;
  mwe?: boolean;
}): FinalPayResult {
  const history = summarizeFinalPayHistory(input.history);
  const warnings: string[] = [];

  if (!history.periods) {
    warnings.push("No released payroll history is available for this tax year.");
  }
  if (history.missingTaxableTrace > 0) {
    warnings.push(
      `${history.missingTaxableTrace} released period${history.missingTaxableTrace === 1 ? "" : "s"} lack the stored taxable-compensation trace and were excluded from YTD taxable compensation.`,
    );
  }
  if (history.basicSalaryEarned <= 0 && history.periods > 0) {
    warnings.push("Released payroll history has no BASIC line items, so prorated 13th-month pay cannot be derived automatically.");
  }

  const otherBenefitsUsingExemption = Math.max(0, amountOf(input.otherBenefitsUsingExemption));
  const accrued13th = round2(history.basicSalaryEarned / 12);
  const gross13th = round2(Math.max(0, accrued13th - history.thirteenthPaid));
  const exemptionAlreadyUsed =
    otherBenefitsUsingExemption + Math.min(history.thirteenthPaid, THIRTEENTH_MONTH_EXEMPTION_CAP);
  const remaining13thExemption = Math.max(0, THIRTEENTH_MONTH_EXEMPTION_CAP - exemptionAlreadyUsed);
  const exempt13th = round2(Math.min(gross13th, remaining13thExemption));
  const taxable13th = round2(Math.max(0, gross13th - exempt13th));

  const leave = round2(Math.max(0, amountOf(input.unusedLeaveConversion)));
  const leaveTreatment = input.unusedLeaveTaxTreatment ?? "taxable";
  const leaveTaxable = leaveTreatment === "taxable";

  const unpaidBasic = round2(Math.max(0, amountOf(input.unpaidBasic)));
  const otherTaxable = round2(Math.max(0, amountOf(input.otherTaxableEarnings)));
  const otherNonTaxable = round2(Math.max(0, amountOf(input.nonTaxableEarnings)));

  const currentTaxable = round2(unpaidBasic + otherTaxable + taxable13th + (leaveTaxable ? leave : 0));
  const currentNonTaxable = round2(otherNonTaxable + exempt13th + (leaveTaxable ? 0 : leave));

  const priorEmployerTaxable = round2(Math.max(0, amountOf(input.priorEmployerTaxable)));
  const priorEmployerWithheld = round2(Math.max(0, amountOf(input.priorEmployerTaxWithheld)));
  const annualTaxable = round2(history.taxable + currentTaxable + priorEmployerTaxable);
  const annualTax = input.mwe ? 0 : round2(computeAnnualWithholdingTax(annualTaxable, false));
  const priorWithheld = round2(history.taxWithheld + priorEmployerWithheld);
  const taxBalance = round2(annualTax - priorWithheld);
  const taxToWithhold = round2(Math.max(0, taxBalance));
  const taxRefund = round2(Math.max(0, -taxBalance));
  const taxSettlement = round2(taxRefund - taxToWithhold);

  const otherDeductions = round2(Math.max(0, amountOf(input.otherDeductions)));
  const grossFinalPay = round2(currentTaxable + currentNonTaxable);
  const netFinalPay = round2(grossFinalPay + taxSettlement - otherDeductions);
  const amountDueFromEmployee = round2(Math.max(0, -netFinalPay));

  return {
    releasedPeriods: history.periods,
    ytdGross: history.gross,
    ytdTaxable: history.taxable,
    ytdTaxWithheld: history.taxWithheld,
    basicSalaryEarnedYtd: history.basicSalaryEarned,
    thirteenthPaidYtd: history.thirteenthPaid,
    thirteenthMonth: {
      gross: gross13th,
      exempt: exempt13th,
      taxable: taxable13th,
    },
    leaveConversion: {
      amount: leave,
      treatment: leaveTreatment,
    },
    annualTaxable,
    annualTax,
    taxToWithhold,
    taxRefund,
    taxSettlement,
    otherDeductions,
    grossFinalPay,
    netFinalPay,
    amountDueFromEmployee,
    warnings,
  };
}
