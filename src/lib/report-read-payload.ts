import type { PeopleIntelligenceSummary } from "@/lib/hcm-people-intelligence";

/** Report rows are unusable until shape, selected employer and report key match. */
export type VerifiedReportPayload = {
  organizationId: number;
  legalEntityId: number | null;
  key: string;
  columns: string[];
  rows: string[][];
  generatedAt: string;
  peopleIntelligence?: PeopleIntelligenceSummary;
};

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const nullableNumber = (value: unknown): value is number | null =>
  value === null || finite(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

/** Never accept an empty object as a valid, green People Intelligence summary. */
export function isVerifiedPeopleSummary(value: unknown): value is PeopleIntelligenceSummary {
  if (!record(value) || !date(value.asOf) || !date(value.windowStart) ||
      ![30, 90, 180, 365].includes(value.windowDays as number) ||
      typeof value.historical !== "boolean" || !record(value.coverage)) return false;
  const coverage = value.coverage;
  if (!whole(coverage.eligible) || !whole(coverage.verified) ||
      !whole(coverage.unverified) || !finite(coverage.percent) ||
      coverage.percent < 0 || coverage.percent > 100 ||
      coverage.verified + coverage.unverified !== coverage.eligible) return false;

  for (const field of ["hires", "completedExits", "releasedRunCount"] as const) {
    if (!whole(value[field])) return false;
  }
  for (const field of [
    "headcount", "turnoverRate", "assignedFte", "vacantPositions",
    "activeRequisitions", "recordedAnnualVacancyBudget", "medianHireDays",
    "approvedCompensationDeltaAnnual", "activeCycleBudget",
    "releasedPayrollGross", "releasedPayrollNet",
  ] as const) {
    if (!nullableNumber(value[field])) return false;
  }
  if (!Array.isArray(value.trends) || !value.trends.every((trend: unknown) =>
    record(trend) && date(trend.date) && nullableNumber(trend.headcount) &&
    whole(trend.verified) && whole(trend.eligible))) return false;
  if (value.units !== null && (!Array.isArray(value.units) ||
      !value.units.every((unit: unknown) =>
        record(unit) && typeof unit.orgUnit === "string" && whole(unit.headcount)))) return false;
  return Array.isArray(value.warnings) &&
    value.warnings.every((warning: unknown) => typeof warning === "string");
}

/** Frozen client-side response contracts; never import database-backed reports.ts. */
const EXPECTED_COLUMNS: Record<string, readonly string[]> = {
  headcount: ["Employment type", "Status", "People", "Avg monthly basic"],
  cost: ["Period", "Scope", "Employees", "Gross", "Deductions", "Net"],
  turnover: ["Metric", "People", "Share of workforce"],
  compliance: ["Type", "Count", "Detail"],
  assurance: ["Severity", "Employee", "Control", "Detail", "Current", "Delta"],
  workforce: ["Metric", "Current", "Context"],
  lifecycle: ["Metric", "Current", "Context"],
  people: ["Area", "Metric", "Value", "Evidence / definition"],
};

export function isVerifiedReportPayload(
  value: unknown, organizationId: number, key: string,
  legalEntityId: number | null = null,
): value is VerifiedReportPayload {
  const expectedColumns = EXPECTED_COLUMNS[key];
  if (!expectedColumns || !id(organizationId) || (legalEntityId !== null && !id(legalEntityId)) ||
      !key || !record(value) ||
      value.organizationId !== organizationId ||
      value.legalEntityId !== legalEntityId || value.key !== key ||
      !Array.isArray(value.columns) || value.columns.length !== expectedColumns.length ||
      !value.columns.every((field: unknown, index: number) => field === expectedColumns[index]) ||
      !Array.isArray(value.rows) || typeof value.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.generatedAt))) return false;
  const expectedWidth = value.columns.length;
  if (!value.rows.every((row: unknown) =>
    Array.isArray(row) && row.length === expectedWidth &&
    row.every((cell: unknown) => typeof cell === "string"))) return false;
  // The people summary has its own richer contract and is separately rendered;
  // a missing summary cannot be accepted as an ordinary empty people report.
  if (key === "people" && !isVerifiedPeopleSummary(value.peopleIntelligence)) return false;
  return true;
}

export async function readVerifiedReportPayload(
  organizationId: number, key: string, query: URLSearchParams,
  fetcher: typeof fetch = fetch, legalEntityId: number | null = null,
): Promise<VerifiedReportPayload> {
  if (query.get("organizationId") !== String(organizationId) ||
      query.get("key") !== key) {
    throw new Error("Report request identity did not match the selected employer and report.");
  }
  const response = await fetcher(`/api/reports?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Report source returned HTTP ${response.status}.`);
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error("Report source returned malformed JSON."); }
  if (!isVerifiedReportPayload(body, organizationId, key, legalEntityId)) {
    throw new Error("Report result could not be verified for the selected employer and report.");
  }
  return body;
}
