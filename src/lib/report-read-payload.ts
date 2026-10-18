/** Report rows are unusable until shape, selected employer and report key match. */
export type VerifiedReportPayload = {
  organizationId: number;
  key: string;
  columns: string[];
  rows: string[][];
  generatedAt: string;
  peopleIntelligence?: unknown;
};

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export function isVerifiedReportPayload(
  value: unknown, organizationId: number, key: string,
): value is VerifiedReportPayload {
  if (!id(organizationId) || !key || !record(value) ||
      value.organizationId !== organizationId || value.key !== key ||
      !Array.isArray(value.columns) || value.columns.length === 0 ||
      !value.columns.every((field: unknown) => typeof field === "string" && field.length > 0) ||
      !Array.isArray(value.rows) || typeof value.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.generatedAt))) return false;
  const expectedWidth = value.columns.length;
  if (!value.rows.every((row: unknown) =>
    Array.isArray(row) && row.length === expectedWidth &&
    row.every((cell: unknown) => typeof cell === "string"))) return false;
  // The people summary has its own richer contract and is separately rendered;
  // a missing summary cannot be accepted as an ordinary empty people report.
  if (key === "people" && !record(value.peopleIntelligence)) return false;
  return true;
}

export async function readVerifiedReportPayload(
  organizationId: number, key: string, query: URLSearchParams,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedReportPayload> {
  const response = await fetcher(`/api/reports?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Report source returned HTTP ${response.status}.`);
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error("Report source returned malformed JSON."); }
  if (!isVerifiedReportPayload(body, organizationId, key)) {
    throw new Error("Report result could not be verified for the selected employer and report.");
  }
  return body;
}
