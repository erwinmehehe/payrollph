import type { PayrollVarianceCategory as Category } from "./payroll-variance";

/**
 * A checker may only act on a complete and scoped stored payroll variance.
 * This read contract is supplemental to server-side approval, maker/checker,
 * tenant/legal-employer authorization and payroll assurance.
 */
export type VerifiedVarianceRow = {
  employeeId: number;
  organizationId: number;
  employeeNo: string;
  employeeName: string;
  employeeStatus: string;
  entryStatus: string;
  categories: Category[];
  currentGross: number;
  previousGross: number | null;
  currentNet: number;
  previousNet: number | null;
  netDelta: number | null;
  netPercent: number | null;
  changedLines: Array<{
    code: string; label: string; previous: number | null; current: number;
    delta: number | null; netEffectDelta: number | null; reason: string;
  }>;
  payRevision: null | {
    effectiveDate: string; previousPayBasis: string; previousRateAmount: string;
    newPayBasis: string; newRateAmount: string; reason: string;
  };
};
export type VerifiedVariancePayload = {
  organizationId: number;
  legalEntityId: number | null;
  run: {
    id: number; organizationId: number; legalEntityId: number | null;
    scopeOrgUnitId: number | null;
    periodLabel: string; periodStart: string; periodEnd: string; payDate: string;
    status: string; employeeCount: number; grossPay: number; netPay: number;
    ruleVersion: string; totalChunks: number; processedChunks: number;
  };
  previousRun: null | {
    id: number; legalEntityId: number | null; scopeOrgUnitId: number | null;
    periodLabel: string; payDate: string;
    employeeCount: number; grossPay: number; netPay: number; ruleVersion: string;
  };
  summary: {
    changedEmployees: number; totalEmployeesReviewed: number;
    calculatedEntries: number; expectedEntries: number; coverageComplete: boolean;
    exceptionCount: number; grossDelta: number; netDelta: number;
    categoryCounts: Record<Category, number>;
  };
  rows: VerifiedVarianceRow[];
};
export type PayrollVarianceExpectedRun = {
  id: number; legalEntityId?: number | null; scopeOrgUnitId?: number | null;
  periodLabel: string; periodStart: string; periodEnd: string; payDate: string;
  status: string; employeeCount: number; grossPay: string; netPay: string;
  ruleVersion: string;
};

export const CHECKER_VARIANCE_CATEGORIES = [
  "exception", "salary_change", "overtime_spike", "retro", "new_hire",
  "new_to_run", "separation", "missing_from_run", "bank_details",
  "statutory", "net_variance",
] as const satisfies readonly Category[];
const CATEGORY_SET = new Set<string>(CHECKER_VARIANCE_CATEGORIES);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const amount = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e15;
const optionalAmount = (v: unknown): v is number | null => v === null || amount(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const optionalId = (v: unknown): v is number | null => v === null || id(v);
const day = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v;
};
const moneyString = (v: unknown): v is string =>
  typeof v === "string" && /^-?\d{1,12}(?:\.\d{1,6})?$/.test(v) && Number.isFinite(Number(v));
const near = (x: number, y: number) => Math.abs(x - y) <= 0.011;

function validRow(raw: unknown, organizationId: number): raw is VerifiedVarianceRow {
  if (!object(raw) || !id(raw.employeeId) || raw.organizationId !== organizationId ||
      !text(raw.employeeNo) || !text(raw.employeeName) ||
      !text(raw.employeeStatus) || !text(raw.entryStatus) ||
      !Array.isArray(raw.categories) || raw.categories.length === 0 ||
      raw.categories.length > CHECKER_VARIANCE_CATEGORIES.length ||
      !raw.categories.every((item: unknown) => typeof item === "string" && CATEGORY_SET.has(item)) ||
      new Set(raw.categories).size !== raw.categories.length ||
      !amount(raw.currentGross) || !amount(raw.currentNet) ||
      raw.currentGross < 0 || raw.currentNet < 0 ||
      !optionalAmount(raw.previousGross) || !optionalAmount(raw.previousNet) ||
      !optionalAmount(raw.netDelta) || !optionalAmount(raw.netPercent) ||
      !Array.isArray(raw.changedLines) || raw.changedLines.length > 5) return false;
  if (raw.previousNet !== null && raw.netDelta !== null &&
      !near(raw.currentNet - raw.previousNet, raw.netDelta)) return false;
  for (const line of raw.changedLines) {
    if (!object(line) || !text(line.code) || !text(line.label) ||
        !optionalAmount(line.previous) || !amount(line.current) ||
        !optionalAmount(line.delta) || !optionalAmount(line.netEffectDelta) ||
        typeof line.reason !== "string") return false;
  }
  if (raw.payRevision !== null) {
    const rev = raw.payRevision;
    if (!object(rev) || !day(rev.effectiveDate) ||
        !text(rev.previousPayBasis) || !text(rev.newPayBasis) ||
        !moneyString(rev.previousRateAmount) || !moneyString(rev.newRateAmount) ||
        typeof rev.reason !== "string") return false;
  }
  return true;
}
function validPrior(raw: unknown, run: Record<string, unknown>): boolean {
  if (raw === null) return true;
  return object(raw) && id(raw.id) && raw.id !== run.id &&
    raw.legalEntityId === run.legalEntityId &&
    raw.scopeOrgUnitId === run.scopeOrgUnitId &&
    text(raw.periodLabel) && day(raw.payDate) &&
    count(raw.employeeCount) && amount(raw.grossPay) && amount(raw.netPay) &&
    text(raw.ruleVersion);
}
export function isVerifiedPayrollCheckerVariance(
  payload: unknown, organizationId: number, expected: PayrollVarianceExpectedRun,
): payload is VerifiedVariancePayload {
  if (!id(organizationId) || !id(expected.id) ||
      !object(payload) || payload.organizationId !== organizationId ||
      !object(payload.run) || !object(payload.summary) ||
      !Array.isArray(payload.rows) || payload.rows.length > 100000) return false;
  const run = payload.run, s = payload.summary;
  if (run.id !== expected.id || run.organizationId !== organizationId ||
      !optionalId(run.legalEntityId) || payload.legalEntityId !== run.legalEntityId ||
      !optionalId(run.scopeOrgUnitId) ||
      (expected.legalEntityId !== undefined && run.legalEntityId !== expected.legalEntityId) ||
      (expected.scopeOrgUnitId !== undefined && run.scopeOrgUnitId !== expected.scopeOrgUnitId) ||
      run.periodLabel !== expected.periodLabel || run.periodStart !== expected.periodStart ||
      run.periodEnd !== expected.periodEnd || run.payDate !== expected.payDate ||
      run.status !== expected.status || run.ruleVersion !== expected.ruleVersion ||
      !day(run.periodStart) || !day(run.periodEnd) || !day(run.payDate) ||
      !count(run.employeeCount) || run.employeeCount !== expected.employeeCount ||
      !amount(run.grossPay) || !amount(run.netPay) ||
      !near(run.grossPay, Number(expected.grossPay)) ||
      !near(run.netPay, Number(expected.netPay)) ||
      !count(run.totalChunks) || !count(run.processedChunks) ||
      !validPrior(payload.previousRun, run)) return false;
  if (!count(s.changedEmployees) || !count(s.totalEmployeesReviewed) ||
      !count(s.calculatedEntries) || !count(s.expectedEntries) ||
      !count(s.exceptionCount) || typeof s.coverageComplete !== "boolean" ||
      !amount(s.grossDelta) || !amount(s.netDelta) ||
      !object(s.categoryCounts) || s.changedEmployees !== payload.rows.length ||
      s.totalEmployeesReviewed < s.changedEmployees ||
      s.expectedEntries !== run.employeeCount || s.calculatedEntries > s.expectedEntries) return false;
  const prior = payload.previousRun as Record<string, unknown> | null;
  const priorGross = prior ? prior.grossPay as number : 0;
  const priorNet = prior ? prior.netPay as number : 0;
  if (!near(s.grossDelta, run.grossPay - priorGross) ||
      !near(s.netDelta, run.netPay - priorNet)) return false;
  const coverage = run.employeeCount > 0 &&
    s.calculatedEntries === run.employeeCount &&
    run.totalChunks > 0 && run.processedChunks >= run.totalChunks;
  if (s.coverageComplete !== coverage) return false;
  const distinctEmployees = new Set<number>();
  const categories = Object.fromEntries(
    CHECKER_VARIANCE_CATEGORIES.map(name => [name, 0]),
  ) as Record<Category, number>;
  for (const row of payload.rows) {
    if (!validRow(row, organizationId) || distinctEmployees.has(row.employeeId)) return false;
    distinctEmployees.add(row.employeeId);
    for (const category of row.categories) categories[category]++;
  }
  for (const category of CHECKER_VARIANCE_CATEGORIES) {
    if (!count(s.categoryCounts[category]) || s.categoryCounts[category] !== categories[category]) return false;
  }
  return s.exceptionCount === categories.exception;
}
export async function readVerifiedPayrollCheckerVariance(
  organizationId: number, expected: PayrollVarianceExpectedRun,
  fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedVariancePayload> {
  if (!id(organizationId) || !id(expected.id)) throw Error("Choose a valid employer and payroll run.");
  const response = await fetcher("/api/payroll-runs/" + expected.id + "/variance", {
    cache: "no-store", signal,
  });
  if (!response.ok) throw Error("Payroll checker evidence unavailable. Retry before approving.");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw Error("Payroll checker evidence was unreadable. Retry before approving."); }
  if (!isVerifiedPayrollCheckerVariance(value, organizationId, expected)) {
    throw Error("Payroll checker evidence incomplete, inconsistent, or from another employer. Retry before approving.");
  }
  return value;
}
