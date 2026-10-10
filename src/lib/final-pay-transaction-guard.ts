/**
 * PostgreSQL can abort a serializable final-pay transaction if concurrent
 * payroll/loan/HCM writes make its financial snapshot unsafe. Drizzle wraps
 * driver errors; preserve the decision without exposing internal SQL.
 *
 * Never retry a money-bearing action automatically. A human must refresh and
 * compare the current ledger before a new approval or release attempt.
 */
export function isRetryableFinalPayConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object" || seen.has(current)) break;
    seen.add(current);
    const issue = current as { code?: unknown; cause?: unknown };
    if (issue.code === "40001" || issue.code === "40P01") return true;
    current = issue.cause;
  }
  return false;
}

export const FINAL_PAY_CONCURRENT_SOURCE_CONFLICT = {
  code: "FINAL_PAY_CONCURRENT_SOURCE_CONFLICT",
  error: "A payroll, loan or employee record changed concurrently with this final-pay decision. No decision was committed. Refresh the latest source ledger and request independent review again.",
} as const;
