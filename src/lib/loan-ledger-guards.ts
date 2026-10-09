/**
 * Data-boundary validation for loans that can automatically affect net pay.
 * These checks intentionally do not provide an overpayment-recovery route.
 * Recovery, waiver and payroll-clawback cases require their own independent
 * wage-deduction policy and maker/checker review.
 */
export const SUPPORTED_LOAN_TYPES = [
  "SSS Salary Loan",
  "SSS Calamity Loan",
  "Pag-IBIG Multi-Purpose Loan (MPL)",
  "Pag-IBIG Calamity Loan",
  "Company Emergency Loan",
  "Educational Assistance Loan",
  "Appliance / Gadget Loan",
] as const;

export type SupportedLoanType = (typeof SUPPORTED_LOAN_TYPES)[number];
export const MAX_LOAN_PRINCIPAL_CENTS = 999_999_999_999; // numeric(12,2)
export const MAX_PAYMENT_CENTS = 9_999_999_999; // numeric(10,2)

export function phpCents(input: unknown, limit = MAX_LOAN_PRINCIPAL_CENTS): number | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  if (typeof input === "number" && !Number.isFinite(input)) return null;
  const text = String(input).trim();
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= limit ? cents : null;
}

/**
 * Fails closed for legacy (pre-validation) schedules as well as newly
 * registered loans. Never pass negative, zero, NaN, infinite or overprecision
 * cutoff requests into the gross-to-net payroll engine.
 */
export function validPayrollLoanSchedule(loan: { cutoffDeduction: number; remainingBalance: number }): boolean {
  const cutoff = phpCents(loan.cutoffDeduction, MAX_PAYMENT_CENTS);
  const remaining = phpCents(loan.remainingBalance, MAX_LOAN_PRINCIPAL_CENTS);
  return cutoff != null && cutoff > 0 && remaining != null && remaining > 0;
}

export function pesoString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid positive centavo amount.");
  return (cents / 100).toFixed(2);
}

export function isoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type ValidLoanRegistration = {
  loanType: SupportedLoanType;
  referenceNo: string;
  authorizationEvidenceReference: string;
  principalCents: number;
  monthlyCents: number;
  cutoffCents: number;
  startDate: string;
  endDate: string | null;
  notes: string;
};

export function validateLoanRegistration(body: Record<string, unknown>):
  | { ok: true; value: ValidLoanRegistration }
  | { ok: false; code: string; error: string } {
  const loanType = body.loanType;
  if (typeof loanType !== "string" || !SUPPORTED_LOAN_TYPES.some(type => type === loanType)) {
    return { ok: false, code: "LOAN_TYPE_UNSUPPORTED", error: "Select an approved loan type. Payroll overpayment recovery or an arbitrary payroll deduction cannot be entered as an employee loan." };
  }
  const referenceNo = typeof body.referenceNo === "string" ? body.referenceNo.trim() : "";
  const authorizationEvidenceReference = typeof body.authorizationEvidenceReference === "string"
    ? body.authorizationEvidenceReference.trim() : "";
  if (referenceNo.length < 6 || referenceNo.length > 64 || /[\r\n\u0000-\u001f]/.test(referenceNo)) {
    return { ok: false, code: "LOAN_REFERENCE_INVALID", error: "Provide the 6-64 character bank/government/contract loan reference." };
  }
  if (authorizationEvidenceReference.length < 8 || authorizationEvidenceReference.length > 200
    || /[\r\n\u0000-\u001f]/.test(authorizationEvidenceReference)) {
    return { ok: false, code: "LOAN_AUTHORIZATION_EVIDENCE_REQUIRED", error: "Provide an 8-200 character traceable borrower authorization or government loan notice reference. Do not enter a raw bank account or government ID." };
  }
  const principalCents = phpCents(body.principal);
  const monthlyCents = phpCents(body.monthlyAmortization, MAX_PAYMENT_CENTS);
  const providedCutoff = body.cutoffDeduction;
  const cutoffCents = providedCutoff == null || providedCutoff === ""
    ? monthlyCents == null ? null : Math.round(monthlyCents / 2)
    : phpCents(providedCutoff, MAX_PAYMENT_CENTS);
  if (principalCents == null || monthlyCents == null || cutoffCents == null
    || principalCents <= 0 || monthlyCents <= 0 || cutoffCents <= 0
    || cutoffCents > monthlyCents || cutoffCents > principalCents
    || monthlyCents > principalCents) {
    return { ok: false, code: "LOAN_AMORTIZATION_INVALID", error: "Loan principal, monthly amortization and cutoff deduction must be positive exact PHP centavos. Cutoff deduction cannot exceed the monthly amount or outstanding principal; amortization cannot exceed principal." };
  }
  const startDate = body.startDate;
  const endDate = body.endDate === "" || body.endDate == null ? null : body.endDate;
  if (!isoCalendarDate(startDate)
    || (endDate != null && (!isoCalendarDate(endDate) || endDate < startDate))) {
    return { ok: false, code: "LOAN_DATES_INVALID", error: "Provide a real YYYY-MM-DD loan start date and an optional end date not earlier than the start date." };
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 1000) {
    return { ok: false, code: "LOAN_NOTES_TOO_LONG", error: "Limit loan notes to 1,000 characters." };
  }
  return { ok: true, value: {
    loanType: loanType as SupportedLoanType, referenceNo,
    authorizationEvidenceReference, principalCents, monthlyCents,
    cutoffCents, startDate, endDate, notes,
  } };
}

export function validManualRepayment(amount: unknown, evidenceReference: unknown) {
  const amountCents = phpCents(amount, MAX_PAYMENT_CENTS);
  const reference = typeof evidenceReference === "string" ? evidenceReference.trim() : "";
  if (amountCents == null || amountCents <= 0 || reference.length < 8 || reference.length > 120
    || /[\r\n\u0000-\u001f]/.test(reference)) {
    return { ok: false as const, error: "Provide a positive exact-centavo repayment (up to PHP 99,999,999.99) and an 8-120 character independent receipt/bank transaction reference." };
  }
  return { ok: true as const, amountCents, reference };
}

export function nextLoanState(
  action: "pause" | "resume" | "close",
  current: string,
  remainingCents: number,
  workerStatus: string,
): { ok: true; next: "active" | "paused" | "paid_off" } | { ok: false; code: string; error: string } {
  if (action === "pause" && current === "active" && remainingCents > 0) return { ok: true, next: "paused" };
  if (action === "resume" && current === "paused" && remainingCents > 0
    && ["Active", "On leave"].includes(workerStatus)) return { ok: true, next: "active" };
  if (action === "close" && remainingCents === 0 && current !== "paid_off") return { ok: true, next: "paid_off" };
  if (action === "close" && remainingCents > 0) {
    return { ok: false, code: "LOAN_OUTSTANDING_CANNOT_CLOSE",
      error: "Cannot mark a loan paid off with a positive balance. Pause the schedule or initiate a separately reviewed debt-write-off case; do not erase outstanding money." };
  }
  return { ok: false, code: "LOAN_STATUS_TRANSITION_INVALID",
    error: "The loan is already in that state, is paid off, or its worker is ineligible for resumed payroll deductions." };
}
