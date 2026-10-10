/** Centavo-exact monetary input validation for employee loan deductions. */
export function parseLoanCents(value: unknown, maxCents = 999_999_999_999): number | null {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "");
  if (!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, decimal = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= maxCents ? cents : null;
}

export function moneyFromCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Expected non-negative integer centavos");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function validLoanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function independentLoanReviewer(
  requesterUserId: number | null,
  reviewerUserId: number,
): "LOAN_REQUESTER_UNKNOWN" | "LOAN_SELF_APPROVAL" | null {
  if (!requesterUserId) return "LOAN_REQUESTER_UNKNOWN";
  if (requesterUserId === reviewerUserId) return "LOAN_SELF_APPROVAL";
  return null;
}

export type LoanPayrollConflictInput = {
  periodEnd: string;
  status: string;
  employeeCount: number;
  processedChunks: number;
  scopeOrgUnitId: number | null;
};

export function activeLoanPayrollConflict<T extends LoanPayrollConflictInput>(
  runs: T[],
  startDate: string,
  employeeOrgUnitId: number | null,
): T | null {
  return runs.find(run =>
    run.periodEnd >= startDate
    && (run.scopeOrgUnitId == null || run.scopeOrgUnitId === employeeOrgUnitId)
    && run.status !== "Released"
    && (run.status !== "Draft" || run.employeeCount > 0 || run.processedChunks > 0)
  ) ?? null;
}

export function loanApprovalReference(value: unknown): string | null {
  const reference = typeof value === "string" ? value.trim() : "";
  return reference.length >= 8 && reference.length <= 200
    && !/[\r\n\u0000-\u001f]/.test(reference) ? reference : null;
}

/** Only employer-supported loan products can enter the wage-deduction review path. */
export const SUPPORTED_PAYROLL_LOAN_TYPES = [
  "SSS Salary Loan",
  "SSS Calamity Loan",
  "Pag-IBIG Multi-Purpose Loan (MPL)",
  "Pag-IBIG Calamity Loan",
  "Company Emergency Loan",
  "Educational Assistance Loan",
  "Appliance / Gadget Loan",
] as const;

export function approvedPayrollLoanType(value: unknown): boolean {
  return typeof value === "string"
    && SUPPORTED_PAYROLL_LOAN_TYPES.some((name) => name === value);
}

/** Legacy rows may predate registration validation. Never pass malformed deductions into net pay. */
export function validPayrollLoanSchedule(loan: { cutoffDeduction: number; remainingBalance: number }): boolean {
  return parseLoanCents(loan.cutoffDeduction, 9_999_999_999) !== null
    && parseLoanCents(loan.remainingBalance) !== null;
}

/** A manually attested repayment must cite an external receipt, not placeholder text. */
export function externalLoanPaymentReference(value: unknown): string | null {
  const reference = typeof value === "string" ? value.trim() : "";
  if (reference.length < 8 || reference.length > 120
    || /[\r\n\u0000-\u001f]/.test(reference)
    || /\\[nr]/i.test(reference)
    || /^(?:manual payment|direct employee remittance|test payment|testing payment|not applicable|n\/a)$/i.test(reference)) {
    return null;
  }
  return reference;
}
