import { createHash } from "node:crypto";

export const OVERPAYMENT_REVIEW_VERSION = "overpayment-evidence-v1";

export type OverpaymentFinding = {
  code: string;
  severity: "blocker" | "review";
  message: string;
  nextAction: string;
};

export type OverpaymentReviewInput = {
  claimCents: number;
  netPayCents: number | null;
  sourceReleased: boolean;
  sourceEntryCount: number;
  workerStatus: string;
  openLoanCount: number;
  separationStatuses: string[];
  existingRetroCount: number;
};

/** Source claims must be exact centavos, not JS floats or negative deductions. */
export function parsePositivePesoCents(input: unknown): number | null {
  const raw = typeof input === "string" ? input.trim() : String(input ?? "");
  if (!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/.test(raw)) return null;
  const [pesos, fraction = ""] = raw.split(".");
  const cents = Number(pesos) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 99_999_999_999) return null;
  return cents;
}

export function parseLedgerPesoCents(value: string | number): number | null {
  const raw = String(value).trim();
  if (!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/.test(raw)) return null;
  const [pesos, fraction = ""] = raw.split(".");
  const cents = Number(pesos) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function pesoCentsString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 99_999_999_999) {
    throw new Error("Cannot format an invalid currency amount.");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** A source hash identifies the exact released entry; it is NOT bank-payment proof. */
export function releasedPayrollEntryFingerprint(entry: {
  id: number;
  payrollRunId: number;
  employeeId: number;
  grossPay: string | number;
  deductions: string | number;
  netPay: string | number;
  status: string;
  lineItems: unknown;
  trace: unknown;
}): string {
  return createHash("sha256").update(JSON.stringify({
    version: OVERPAYMENT_REVIEW_VERSION,
    entryId: entry.id,
    runId: entry.payrollRunId,
    employeeId: entry.employeeId,
    grossPay: String(entry.grossPay),
    deductions: String(entry.deductions),
    netPay: String(entry.netPay),
    status: entry.status,
    lineItems: entry.lineItems,
    trace: entry.trace,
  })).digest("hex");
}

/** Evidence only. No result can authorize wage withholding or payroll mutation. */
export function assessOverpaymentReview(input: OverpaymentReviewInput) {
  const findings: OverpaymentFinding[] = [];
  const add = (code: string, severity: OverpaymentFinding["severity"], message: string, nextAction: string) =>
    findings.push({ code, severity, message, nextAction });

  if (!input.sourceReleased) add(
    "SOURCE_NOT_RELEASED", "blocker",
    "The selected payroll run is not Released.",
    "Use a Released payroll source and independently verify its approved register.",
  );
  if (input.sourceEntryCount !== 1) add(
    "SOURCE_ENTRY_AMBIGUOUS", "blocker",
    "The selected worker must have exactly one entry in the source payroll.",
    "Reconcile missing or duplicate payroll rows before investigating a wage difference.",
  );
  if (!Number.isSafeInteger(input.claimCents) || input.claimCents <= 0) add(
    "INVALID_CLAIM_AMOUNT", "blocker",
    "The claimed difference is not a positive centavo amount.",
    "Enter a source-supported, non-negative payroll discrepancy; never use this to issue a deduction.",
  );
  if (input.netPayCents === null || !Number.isSafeInteger(input.netPayCents) || input.netPayCents < 0) add(
    "SOURCE_NET_UNAVAILABLE", "blocker",
    "The selected payroll net amount is unavailable or invalid.",
    "Reconcile the original Released register with the payroll source before continuing.",
  );
  if (input.netPayCents !== null && input.claimCents > input.netPayCents) add(
    "CLAIM_EXCEEDS_SOURCE_NET", "blocker",
    "The suspected overpayment exceeds the recorded source net pay.",
    "Check the source claim and payment history. No liability or recovery amount can be inferred.",
  );
  if (input.workerStatus === "Separating" || input.workerStatus === "Separated") add(
    "SEPARATION_REVIEW_REQUIRED", "review",
    "The employee is in a separation lifecycle.",
    "Refer to HR and final-pay evidence. Never offset a claimed overpayment against final pay automatically.",
  );
  if (input.separationStatuses.length > 0) add(
    "FINAL_PAY_HISTORY_EXISTS", "review",
    "This employee has separation/final-pay records.",
    "Independently reconcile any approved or released final-pay history and statutory obligations.",
  );
  if (input.openLoanCount > 0) add(
    "LOAN_DEDUCTIONS_PRESENT", "review",
    "The employee has existing loan balances requiring separate reconciliation.",
    "Check authorized loan amortization separately; a suspected overpayment is not an additional loan.",
  );
  if (input.existingRetroCount > 0) add(
    "EXISTING_RETRO_ADJUSTMENT", "review",
    "Payroll already records a retroactive adjustment for this source employee/run.",
    "Check for previously recorded correction or duplicate settlement before starting a new case.",
  );

  // These are mandatory for every investigation, including a clean source.
  // A human claim or entered reference is not proof of either payment or lawfulness.
  add(
    "BANK_DISBURSEMENT_UNVERIFIED", "review",
    "Released payroll is not independent proof that the worker received funds.",
    "Reconcile the real bank payout, exceptions and reversals before making any overpayment allegation.",
  );
  add(
    "LAWFUL_DEDUCTION_NOT_ESTABLISHED", "review",
    "An employer claim cannot by itself authorize wage withholding.",
    "Obtain independent Philippine labor/legal review, examine any actual written authorization and allow the employee to respond; do not deduct automatically.",
  );

  const hasBlockers = findings.some(finding => finding.severity === "blocker");
  return {
    status: hasBlockers ? "source_blocked" as const : "manual_review_only" as const,
    findings,
    deductionAuthorized: false as const,
    recoveryPosted: false as const,
    sourceConfirmsBankPayment: false as const,
    requiredIndependentEvidence: [
      "Original approved payroll computation, attendance/pay basis and source register",
      "Actual bank credit and reversal evidence from the payment provider",
      "Independent explanation of discrepancy, including tax and statutory effect",
      "Employee notice/opportunity to dispute, plus any applicable lawful written authorization",
      "Separate HR/payroll and legal review before considering any deduction or reimbursement process",
    ],
  };
}
