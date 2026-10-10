import { createHash } from "node:crypto";

/**
 * Arithmetic for a READ-ONLY historical payroll review. This module never
 * returns a legally recoverable amount or authorizes a deduction.
 */
export const MAX_PREVIEW_CENTAVOS = 99_999_999_999; // PHP 999,999,999.99.

export function pesosToCentavos(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const input = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_PREVIEW_CENTAVOS) return null;
  return cents;
}

export function centsAsPesos(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error("Centavo amount must be an integer.");
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return sign + String(Math.floor(abs / 100)) + "." + String(abs % 100).padStart(2, "0");
}

export type OverpaymentVariance = {
  reviewStatus: "possible_overpayment" | "possible_underpayment" | "mixed_variance" | "no_variance";
  sourceGross: string;
  sourceDeductions: string;
  sourceNet: string;
  verifiedGross: string;
  verifiedNet: string;
  grossDifference: string;
  netDifference: string;
  verifiedImpliedDeductions: string;
  hasSourceArithmeticWarning: boolean;
  automatedRecoveryAllowed: false;
};

export type OverpaymentPreviewResult =
  | { ok: false; code: "INVALID_AMOUNT" | "INCONSISTENT_VERIFIED_VALUES"; error: string }
  | { ok: true; variance: OverpaymentVariance };

export function compareReleasedPayrollWithVerifiedAmounts(
  source: { grossPay: string; deductions: string; netPay: string },
  verified: { grossPay: unknown; netPay: unknown },
): OverpaymentPreviewResult {
  const originalGross = pesosToCentavos(source.grossPay);
  const originalDeductions = pesosToCentavos(source.deductions);
  const originalNet = pesosToCentavos(source.netPay);
  const verifiedGross = pesosToCentavos(verified.grossPay);
  const verifiedNet = pesosToCentavos(verified.netPay);
  if ([originalGross, originalDeductions, originalNet, verifiedGross, verifiedNet].some(x => x == null)) {
    return { ok: false, code: "INVALID_AMOUNT", error: "All original and independently verified amounts must be non-negative PHP values with no more than two decimal places." };
  }
  // The null checks above guard every cast. Integer arithmetic is used to
  // avoid silently introducing floating centavo rounding into an HR case.
  const gross = originalGross as number;
  const deductions = originalDeductions as number;
  const net = originalNet as number;
  const expectedGross = verifiedGross as number;
  const expectedNet = verifiedNet as number;
  if (expectedNet > expectedGross) {
    return { ok: false, code: "INCONSISTENT_VERIFIED_VALUES", error: "Verified net pay exceeds verified gross pay. This preview cannot classify special reimbursements or net credits; reconcile those separately." };
  }
  const grossDifference = gross - expectedGross;
  const netDifference = net - expectedNet;
  const bothPositive = grossDifference > 0 && netDifference > 0;
  const bothNegative = grossDifference < 0 && netDifference < 0;
  const bothZero = grossDifference === 0 && netDifference === 0;
  const reviewStatus: OverpaymentVariance["reviewStatus"] = bothZero
    ? "no_variance"
    : bothPositive ? "possible_overpayment"
    : bothNegative ? "possible_underpayment"
    : "mixed_variance";

  return {
    ok: true,
    variance: {
      reviewStatus,
      sourceGross: centsAsPesos(gross),
      sourceDeductions: centsAsPesos(deductions),
      sourceNet: centsAsPesos(net),
      verifiedGross: centsAsPesos(expectedGross),
      verifiedNet: centsAsPesos(expectedNet),
      grossDifference: centsAsPesos(grossDifference),
      netDifference: centsAsPesos(netDifference),
      verifiedImpliedDeductions: centsAsPesos(expectedGross - expectedNet),
      hasSourceArithmeticWarning: Math.abs(gross - deductions - net) > 1,
      automatedRecoveryAllowed: false,
    },
  };
}

export type PayrollSourceEvidence = {
  entryId: number;
  runId: number;
  employeeId: number;
  grossPay: string;
  deductions: string;
  netPay: string;
  status: string;
  lineItems: unknown;
  trace: unknown;
};

/** Detect later modification of a referenced released register entry. */
export function fingerprintReleasedPayrollEntry(entry: PayrollSourceEvidence): string {
  return createHash("sha256").update(JSON.stringify({
    id: entry.entryId, payrollRunId: entry.runId, employeeId: entry.employeeId,
    grossPay: entry.grossPay, deductions: entry.deductions, netPay: entry.netPay,
    status: entry.status, lineItems: entry.lineItems, trace: entry.trace,
  })).digest("hex");
}
