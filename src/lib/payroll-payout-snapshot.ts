import { sameBankAccount } from "@/lib/bank-account-crypto";

/**
 * This is captured within each payroll entry's trace at calculation.
 * Live money movement MUST NOT fall back to mutable employee master data.
 */
export type FrozenPayrollPayment = {
  employeeName: string;
  employeeNo: string;
  bankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
};

type CurrentDestination = {
  employeeNo: string;
  bankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
};

function nullable(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function bankCode(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase() || null;
}

export function frozenReleasedPayrollPayment(input: {
  entryId: number;
  trace: unknown;
  current: CurrentDestination;
}): FrozenPayrollPayment {
  const root = input.trace && typeof input.trace === "object" && !Array.isArray(input.trace)
    ? input.trace as Record<string, unknown> : null;
  const raw = root?.payment;
  const payment = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
  if (!payment
    || typeof payment.employeeName !== "string"
    || !payment.employeeName.trim()
    || typeof payment.employeeNo !== "string"
    || !payment.employeeNo.trim()
    || !Object.prototype.hasOwnProperty.call(payment, "bankAccount")
    || !Object.prototype.hasOwnProperty.call(payment, "bankCode")
    || !Object.prototype.hasOwnProperty.call(payment, "mobile")
    || (payment.bankAccount != null && typeof payment.bankAccount !== "string")
    || (payment.bankCode != null && typeof payment.bankCode !== "string")
    || (payment.mobile != null && typeof payment.mobile !== "string")) {
    throw new Error(
      `PAYOUT_FROZEN_DESTINATION_REQUIRED: payroll entry #${input.entryId} lacks a complete immutable payment snapshot. No payout was attempted.`,
    );
  }
  const frozen: FrozenPayrollPayment = {
    employeeName: payment.employeeName.trim(),
    employeeNo: payment.employeeNo.trim(),
    bankAccount: nullable(payment.bankAccount),
    bankCode: nullable(payment.bankCode),
    mobile: nullable(payment.mobile),
  };
  if (frozen.employeeNo !== input.current.employeeNo
    || !sameBankAccount(frozen.bankAccount, input.current.bankAccount)
    || bankCode(frozen.bankCode) !== bankCode(input.current.bankCode)
    || frozen.mobile !== nullable(input.current.mobile)) {
    throw new Error(
      `PAYOUT_DESTINATION_CHANGED_AFTER_CALCULATION: payroll entry #${input.entryId} does not match its current employee payout destination. Require an independently reviewed payout reauthorization; no payout was attempted.`,
    );
  }
  return frozen;
}

export function assertReleasedPayoutTotals(input: {
  expectedEmployeeCount: number;
  expectedNetPay: string | number;
  amountsCents: readonly number[];
}): void {
  const expected = Number(input.expectedNetPay);
  if (!Number.isSafeInteger(input.expectedEmployeeCount)
    || input.expectedEmployeeCount <= 0
    || input.amountsCents.length !== input.expectedEmployeeCount
    || !Number.isFinite(expected) || expected < 0
    || !Number.isSafeInteger(Math.round(expected * 100))
    || Math.abs(expected * 100 - Math.round(expected * 100)) > 0.001) {
    throw new Error("PAYOUT_REGISTER_RECONCILIATION_FAILED: released employee count or net payroll amount is invalid. No payout was attempted.");
  }
  const sum = input.amountsCents.reduce((total, cents) => {
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new Error("PAYOUT_REGISTER_RECONCILIATION_FAILED: invalid employee net pay. No payout was attempted.");
    }
    return total + cents;
  }, 0);
  if (!Number.isSafeInteger(sum) || sum !== Math.round(expected * 100)) {
    throw new Error("PAYOUT_REGISTER_RECONCILIATION_FAILED: payout sum differs from released payroll net pay. No payout was attempted.");
  }
}
