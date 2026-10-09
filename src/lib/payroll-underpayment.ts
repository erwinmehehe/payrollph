import { createHash } from "node:crypto";

export const UNDERPAYMENT_MAX_CENTS = 100_000_000;

export function parsePositiveUnderpaymentCents(value: unknown): number | null {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "");
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= UNDERPAYMENT_MAX_CENTS ? cents : null;
}

export function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function payrollSourceFingerprint(entry: {
  id: number; payrollRunId: number; employeeId: number;
  grossPay: string | number; netPay: string | number; lineItems: unknown;
}) {
  return createHash("sha256").update(JSON.stringify({
    id: entry.id, payrollRunId: entry.payrollRunId,
    employeeId: entry.employeeId,
    grossPay: entry.grossPay, netPay: entry.netPay, lineItems: entry.lineItems,
  })).digest("hex");
}

export function conflictingCutoff<T extends {
  periodStart: string; periodEnd: string; scopeOrgUnitId: number | null;
  status: string; processedChunks: number; employeeCount: number;
}>(
  runs: T[], employeeOrgUnitId: number | null, effectiveDate: string,
): T | null {
  return runs.find(run =>
    run.periodStart <= effectiveDate && run.periodEnd >= effectiveDate
    && (run.scopeOrgUnitId == null || run.scopeOrgUnitId === employeeOrgUnitId)
    && (run.status !== "Draft" || run.processedChunks > 0 || run.employeeCount > 0)
  ) ?? null;
}
