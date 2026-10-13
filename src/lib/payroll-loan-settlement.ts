import { storedMoneyCentavos } from "@/lib/stored-money-centavos";
import { moneyFromCents } from "@/lib/payroll-loan-approval";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/** A replay is valid only when the stored payment is exactly the planned
 * deduction. Never treat a 1-cent difference as an idempotent release.
 */
export function exactLoanPaymentReplayMatches(plannedDeduction: unknown, storedAmount: unknown): boolean {
  const planned = storedMoneyCentavos(plannedDeduction);
  const stored = storedMoneyCentavos(storedAmount);
  return planned !== null && planned > 0 && planned === stored;
}

/** Keep the existing release posting until the exact-centavo rollout is enabled. */
export function payrollLoanPosting(input: {
  loanId: number;
  plannedDeduction: number;
  remainingBalance: unknown;
  totalPaid: unknown;
}, env: Readonly<Record<string, string | undefined>> = process.env): ReturnType<typeof settlePayrollLoanBalance> {
  if (criticalReleaseFlagEnabled("exactPayrollLoanSettlement", env)) {
    return settlePayrollLoanBalance(input);
  }
  const remaining = Number(input.remainingBalance);
  if (input.plannedDeduction > remaining + 0.01) {
    throw new Error(`Loan ${input.loanId} balance changed after calculation; recalculate payroll before release.`);
  }
  const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
  const balance = Math.max(0, remaining - input.plannedDeduction);
  return {
    deduction: money(input.plannedDeduction),
    remainingBalance: money(balance),
    totalPaid: money(Number(input.totalPaid) + input.plannedDeduction),
    status: balance <= 0 ? "paid_off" : "active",
  };
}

/**
 * Exact release-time employee loan posting. No tolerances on a numeric(12,2)
 * balance: even a one-cent overpayment must block payroll release. This is
 * distinct from previewing or granting wage deduction authority.
 */
export function settlePayrollLoanBalance(input: {
  plannedDeduction: unknown;
  remainingBalance: unknown;
  totalPaid: unknown;
}): {
  deduction: string;
  remainingBalance: string;
  totalPaid: string;
  status: "active" | "paid_off";
} {
  const deduction = storedMoneyCentavos(input.plannedDeduction);
  const remaining = storedMoneyCentavos(input.remainingBalance);
  const paid = storedMoneyCentavos(input.totalPaid);
  if (deduction === null || deduction <= 0 || remaining === null ||
      remaining <= 0 || paid === null || paid < 0 || deduction > remaining) {
    throw new Error("LOAN_SETTLEMENT_INVALID_OR_EXCEEDS_BALANCE");
  }
  const afterPaid = paid + deduction;
  const afterRemaining = remaining - deduction;
  // NUMERIC(12,2) monetary values and JS safe integer ceilings.
  if (!Number.isSafeInteger(afterPaid) || afterPaid > 999_999_999_999 ||
      !Number.isSafeInteger(afterRemaining)) {
    throw new Error("LOAN_SETTLEMENT_OVERFLOW");
  }
  return {
    deduction: moneyFromCents(deduction),
    remainingBalance: moneyFromCents(afterRemaining),
    totalPaid: moneyFromCents(afterPaid),
    status: afterRemaining === 0 ? "paid_off" : "active",
  };
}
