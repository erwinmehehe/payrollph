import { criticalReleaseFlagEnabled } from "./critical-release-flags";

type PayoutEmployee = {
  id: number;
  bankAccount?: string | null;
  bankCode?: string | null;
  mobile?: string | null;
};

/** Calculation is not payment authority. The opted-in draft may be calculated
 * before destinations are collected; assurance, review and release still run
 * their existing independent checks against the stored register and employees.
 * This policy only accepts the already authorized employer/scope cohort.
 */
export function payrollDraftPayoutReadiness(
  employees: readonly PayoutEmployee[],
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const missingEmployeeIds = employees.filter(employee =>
    !(employee.bankAccount?.trim() && employee.bankCode?.trim()) && !employee.mobile?.trim(),
  ).map(employee => employee.id);
  const deferred = missingEmployeeIds.length > 0
    && criticalReleaseFlagEnabled("payrollDraftPayoutDeferral", env);
  return {
    allowed: missingEmployeeIds.length === 0 || deferred,
    deferred,
    missingEmployeeIds,
    message: missingEmployeeIds.length === 0 ? null : deferred
      ? "Draft calculation only. Complete payout details and pass payroll assurance before review or release."
      : `${missingEmployeeIds.length} active employee${missingEmployeeIds.length === 1 ? " is" : "s are"} missing a usable bank account or mobile-wallet destination. Complete payout details before starting payroll.`,
  };
}
