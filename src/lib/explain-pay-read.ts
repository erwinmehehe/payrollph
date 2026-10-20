/** Treat pay explanations as unverified until bound to the requested employer, run and employee. */
export type ExplainLine = {
  code: string;
  label: string;
  direction: "earning" | "deduction";
  previous: number | null;
  current: number;
  delta: number | null;
  netEffectDelta: number | null;
  reason: string;
  notes: string[];
};
export type ExplainPayload = {
  organizationId: number;
  legalEntityId: number | null;
  employeeId: number;
  run: { id: number; periodLabel: string };
  previousRun: { id: number; periodLabel: string } | null;
  explanation: {
    currentGross: number;
    currentDeductions: number;
    currentNet: number;
    previousNet: number | null;
    netDelta: number | null;
    netPercent: number | null;
    ruleVersion: string | null;
    context: Record<string, string | number | null>;
    lines: ExplainLine[];
  };
};
export type ExplainReadScope = { organizationId: number; legalEntityId: number | null; runId: number; employeeId: number };
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nullableFinite = (v: unknown) => v === null || finite(v);
const cents = (v: number) => Math.round(v * 100);

function line(value: unknown): value is ExplainLine {
  return record(value) && text(value.code) && text(value.label) &&
    ["earning", "deduction"].includes(String(value.direction)) &&
    finite(value.current) && nullableFinite(value.previous) &&
    nullableFinite(value.delta) && nullableFinite(value.netEffectDelta) &&
    text(value.reason) && Array.isArray(value.notes) && value.notes.every((note: unknown) => typeof note === "string");
}

/** A partial or wrong-identity HTTP 200 cannot become a real employee's payroll explanation. */
export function parseExplainPayRead(value: unknown, expected: ExplainReadScope): ExplainPayload | null {
  if (!id(expected.organizationId) || !id(expected.runId) || !id(expected.employeeId) ||
      !(expected.legalEntityId === null || id(expected.legalEntityId)) ||
      !record(value) || value.organizationId !== expected.organizationId ||
      !Object.hasOwn(value, "legalEntityId") ||
      value.legalEntityId !== expected.legalEntityId || value.employeeId !== expected.employeeId ||
      !record(value.run) || value.run.id !== expected.runId || !text(value.run.periodLabel) ||
      !record(value.explanation)) return null;
  if (value.previousRun !== null && (!record(value.previousRun) ||
      !id(value.previousRun.id) || !text(value.previousRun.periodLabel) ||
      value.previousRun.id === expected.runId)) return null;
  const x = value.explanation;
  if (!finite(x.currentGross) || !finite(x.currentDeductions) || !finite(x.currentNet) ||
      !nullableFinite(x.previousNet) || !nullableFinite(x.netDelta) ||
      !nullableFinite(x.netPercent) ||
      !(x.ruleVersion === null || typeof x.ruleVersion === "string") ||
      !record(x.context) || !Object.values(x.context).every((entry) =>
        entry === null || typeof entry === "string" || finite(entry)) ||
      !Array.isArray(x.lines) || x.lines.length > 500 ||
      !x.lines.every(line)) return null;
  const lines: ExplainLine[] = x.lines;
  if (new Set(lines.map((item) => item.code + "|" + item.label)).size !== lines.length) return null;
  if (x.previousNet === null) {
    if (x.netDelta !== null || x.netPercent !== null) return null;
  } else {
    if (!finite(x.netDelta) || cents(x.currentNet - x.previousNet) !== cents(x.netDelta)) return null;
  }
  if (value.previousRun === null && x.previousNet !== null) return null;
  return value as ExplainPayload;
}
