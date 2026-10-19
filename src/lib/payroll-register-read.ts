import type { PayrollEntry } from "../components/workspace/types";

/** A complete register is scoped to a specific employer and a single payroll run. */
export type VerifiedPayrollRegister = {
  organizationId: number;
  legalEntityId: number | null;
  runId: number;
  entries: PayrollEntry[];
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const amount = (v: unknown): v is string =>
  typeof v === "string" && /^-?[0-9]+(?:\.[0-9]+)?$/.test(v) &&
  Number.isFinite(Number(v));

const validLine = (v: unknown) => isRecord(v) &&
  typeof v.code === "string" && v.code.trim().length > 0 &&
  typeof v.label === "string" && v.label.trim().length > 0 &&
  (amount(v.amount) || (typeof v.amount === "number" && Number.isFinite(v.amount))) &&
  (v.notes === undefined || (Array.isArray(v.notes) &&
    v.notes.every((note: unknown) => typeof note === "string")));

function validEntry(value: unknown, runId: number): value is PayrollEntry {
  return isRecord(value) && id(value.id) && id(value.employeeId) &&
    value.payrollRunId === runId && amount(value.grossPay) &&
    amount(value.deductions) && amount(value.netPay) &&
    typeof value.status === "string" && value.status.length > 0 &&
    isRecord(value.trace) && Array.isArray(value.lineItems) &&
    value.lineItems.every(validLine);
}

/** Missing fields, malformed amounts and a foreign run cannot become a verified empty register. */
export function isVerifiedPayrollRegister(
  value: unknown, organizationId: number, runId: number,
  legalEntityId: number | null = null,
): value is VerifiedPayrollRegister {
  if (!id(organizationId) || !id(runId) ||
      (legalEntityId !== null && !id(legalEntityId)) || !isRecord(value) ||
      value.organizationId !== organizationId ||
      (value.legalEntityId !== null && !id(value.legalEntityId)) ||
      (legalEntityId !== null && value.legalEntityId !== legalEntityId) ||
      value.runId !== runId ||
      !Array.isArray(value.entries) || !value.entries.every((entry) => validEntry(entry, runId))) {
    return false;
  }
  const ids = value.entries.map((entry: PayrollEntry) => entry.id);
  return new Set(ids).size === ids.length;
}

export async function readVerifiedPayrollRegister(
  organizationId: number, runId: number, fetcher: typeof fetch = fetch,
  signal?: AbortSignal, legalEntityId: number | null = null,
): Promise<PayrollEntry[]> {
  if (!id(organizationId) || !id(runId)) {
    throw new Error("The selected payroll employer or run is invalid.");
  }
  const response = await fetcher(`/api/payroll-runs?runId=${runId}&include=entries`, {
    cache: "no-store", signal,
  });
  if (!response.ok) throw new Error("Could not read the selected payroll register.");
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error("Payroll register returned malformed JSON."); }
  if (!isVerifiedPayrollRegister(body, organizationId, runId, legalEntityId)) {
    throw new Error("The payroll register returned incomplete or foreign-employer data.");
  }
  return body.entries;
}
