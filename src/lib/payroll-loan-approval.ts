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
  return reference.length >= 8 && reference.length <= 200 ? reference : null;
}
