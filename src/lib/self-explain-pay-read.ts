import type { ExplainLine } from "./explain-pay-read";

/** This read is employee self-service only. It cannot authorize or recalculate payroll. */
export type SelfExplainScope = {
  organizationId: number;
  employeeId: number;
  entryId: number;
  periodLabel: string;
};

export type SelfExplainPayPayload = {
  organizationId: number;
  employeeId: number;
  entryId: number;
  run: { id: number; periodLabel: string; payDate: string; ruleVersion: string };
  previousRun: { id: number; periodLabel: string; payDate: string; ruleVersion: string } | null;
  explanation: {
    currentGross: number;
    currentDeductions: number;
    currentNet: number;
    previousGross: number | null;
    previousDeductions: number | null;
    previousNet: number | null;
    netDelta: number | null;
    netPercent: number | null;
    ruleVersion: string | null;
    context: Record<string, string | number | null>;
    lines: ExplainLine[];
  };
};

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const maybeNumber = (v: unknown) => v === null || number(v);
const run = (v: unknown) => record(v) && id(v.id) && text(v.periodLabel) &&
  text(v.payDate) && text(v.ruleVersion);
const validLine = (v: unknown): v is ExplainLine =>
  record(v) && text(v.code) && text(v.label) && (v.direction === "earning" || v.direction === "deduction") &&
  number(v.current) && maybeNumber(v.previous) && maybeNumber(v.delta) &&
  maybeNumber(v.netEffectDelta) && text(v.reason) &&
  Array.isArray(v.notes) && v.notes.every((n: unknown) => typeof n === "string");

/** No HTTP 200, omitted array or foreign employer/employee/entry can mean "no change". */
export function parseSelfExplainPayRead(value: unknown, expected: SelfExplainScope): SelfExplainPayPayload | null {
  if (!id(expected.organizationId) || !id(expected.employeeId) || !id(expected.entryId) ||
      !text(expected.periodLabel) || !record(value) ||
      value.organizationId !== expected.organizationId ||
      value.employeeId !== expected.employeeId || value.entryId !== expected.entryId ||
      !run(value.run) || (value.run as Record<string, unknown>).periodLabel !== expected.periodLabel ||
      !(value.previousRun === null || run(value.previousRun)) ||
      !record(value.explanation)) return null;
  const x = value.explanation;
  if (!number(x.currentGross) || !number(x.currentDeductions) || !number(x.currentNet) ||
      !maybeNumber(x.previousGross) || !maybeNumber(x.previousDeductions) ||
      !maybeNumber(x.previousNet) || !maybeNumber(x.netDelta) || !maybeNumber(x.netPercent) ||
      !(x.ruleVersion === null || typeof x.ruleVersion === "string") ||
      !record(x.context) || !Object.values(x.context).every((v) =>
        v === null || typeof v === "string" || number(v)) ||
      !Array.isArray(x.lines) || x.lines.length > 500 || !x.lines.every(validLine)) return null;
  const lines = x.lines as ExplainLine[];
  if (new Set(lines.map(l => l.code + "|" + l.label)).size !== lines.length) return null;
  if (value.previousRun === null && (x.previousGross !== null ||
      x.previousDeductions !== null || x.previousNet !== null)) return null;
  if (x.previousNet === null) {
    if (x.netDelta !== null || x.netPercent !== null) return null;
  } else if (!number(x.netDelta) ||
      Math.round(((x.currentNet as number) - x.previousNet) * 100) !== Math.round(x.netDelta * 100)) return null;
  if (record(value.previousRun) && value.previousRun.id === (value.run as Record<string, unknown>).id) return null;
  return value as SelfExplainPayPayload;
}

/** Network and malformed JSON failures are indistinguishable from unavailable data, never verified empty. */
export async function readVerifiedSelfExplainPay(
  expected: SelfExplainScope,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SelfExplainPayPayload> {
  if (!id(expected.organizationId) || !id(expected.employeeId) || !id(expected.entryId) ||
      !text(expected.periodLabel)) throw new Error("Pay explanation unavailable. Retry.");
  const response = await fetcher("/api/self/payslips/" + expected.entryId + "/explain", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Pay explanation unavailable. Retry.");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new Error("Pay explanation unreadable. Retry."); }
  const verified = parseSelfExplainPayRead(value, expected);
  if (!verified) throw new Error("Pay explanation incomplete or belongs to a different payslip. Retry.");
  return verified;
}
