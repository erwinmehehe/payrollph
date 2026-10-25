import { createHash } from "node:crypto";

/** Immutable payroll math evidence; intentionally excludes the separate payment
 * destination snapshot (bank, phone, address, and personal contact details).
 * Caller snapshots only a committed worker calculation, never a preview. */
export type PayrollCalculationEvidence = {
  organizationId: number;
  legalEntityId: number | null;
  payrollRunId: number;
  payrollJobId: number;
  employeeId: number;
  revision: number;
  previousSnapshotHash: string | null;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  ruleVersion: string;
  grossPay: string;
  deductions: string;
  netPay: string;
  status: string;
  lineItems: unknown;
  trace: unknown;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const literal = JSON.stringify(value);
    if (literal === undefined) throw new Error("Payroll calculation evidence is not JSON-safe.");
    return literal;
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
}

/** Stable across JSONB key reordering. The value is forensic tamper evidence,
 * not a digital signature or a substitute for the database mutation guard. */
export function createPayrollCalculationEvidence(input: PayrollCalculationEvidence) {
  if ([input.organizationId, input.payrollRunId, input.payrollJobId, input.employeeId, input.revision]
    .some(value => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error("PAYROLL_HISTORY_INVALID_IDENTITY");
  }
  if (input.legalEntityId !== null && (!Number.isSafeInteger(input.legalEntityId) || input.legalEntityId < 1)) {
    throw new Error("PAYROLL_HISTORY_INVALID_LEGAL_ENTITY");
  }
  for (const amount of [input.grossPay, input.deductions, input.netPay]) {
    if (!/^-?\d+\.\d{2}$/.test(amount)) throw new Error("PAYROLL_HISTORY_INVALID_MONEY");
  }
  if (input.previousSnapshotHash !== null && !/^[0-9a-f]{64}$/.test(input.previousSnapshotHash)) {
    throw new Error("PAYROLL_HISTORY_INVALID_PREVIOUS_HASH");
  }
  if (!Array.isArray(input.lineItems) || !input.trace ||
    typeof input.trace !== "object" || Array.isArray(input.trace)) {
    throw new Error("PAYROLL_HISTORY_INVALID_TRACE");
  }

  // PAYMENT is a separate, encrypted payout source. It is not needed to
  // reconstruct the calculation and must not proliferate into history.
  const { payment: _discardPayment, ...calculationTrace } = input.trace as Record<string, unknown>;
  void _discardPayment;
  const normalized = JSON.parse(JSON.stringify({ ...input, trace: calculationTrace })) as PayrollCalculationEvidence;
  const snapshotHash = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
  return { ...normalized, snapshotHash };
}

export function verifyPayrollCalculationEvidence(
  record: PayrollCalculationEvidence & { snapshotHash: string },
): boolean {
  const { snapshotHash, ...values } = record;
  return /^[0-9a-f]{64}$/.test(snapshotHash) &&
    createPayrollCalculationEvidence(values).snapshotHash === snapshotHash;
}
