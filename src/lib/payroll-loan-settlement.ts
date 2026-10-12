import { storedMoneyCentavos } from "@/lib/stored-money-centavos";
import { moneyFromCents } from "@/lib/payroll-loan-approval";

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
