/** A preview is never a certified run; a malformed or foreign 200 cannot enable draft creation. */
export type FirstPayrollPreviewScope = {
  organizationId: number; periodStart: string; periodEnd: string; payDate: string;
};
export type FirstPayrollPreview = FirstPayrollPreviewScope & {
  dryRun: true; persisted: false; previewReady: boolean;
  rows: Array<{
    employeeId: number; employeeNo: string; name: string;
    gross: number | null; sss: number | null; philHealth: number | null;
    pagIbig: number | null; withholding: number | null; net: number | null;
    blockers: string[];
  }>;
  blockers: string[]; warnings: string[];
};
const rec = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pos = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const money = (x: unknown): x is number | null =>
  x === null || (typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 1e15);
const texts = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((item: unknown) => typeof item === "string");
const bad = () => Error("First-payroll preview unavailable or not verified for this employer.");
function validRow(value: unknown): boolean {
  return rec(value) && pos(value.employeeId) &&
    typeof value.employeeNo === "string" && value.employeeNo.length > 0 &&
    typeof value.name === "string" && value.name.length > 0 &&
    money(value.gross) && money(value.sss) && money(value.philHealth) &&
    money(value.pagIbig) && money(value.withholding) && money(value.net) &&
    texts(value.blockers);
}
export function isVerifiedFirstPayrollPreview(
  value: unknown, expected: FirstPayrollPreviewScope,
): value is FirstPayrollPreview {
  if (!pos(expected.organizationId) || !rec(value) ||
      value.organizationId !== expected.organizationId ||
      value.periodStart !== expected.periodStart ||
      value.periodEnd !== expected.periodEnd || value.payDate !== expected.payDate ||
      value.dryRun !== true || value.persisted !== false ||
      typeof value.previewReady !== "boolean" ||
      !Array.isArray(value.rows) || !value.rows.every(validRow) ||
      !texts(value.blockers) || !texts(value.warnings)) return false;
  const ids = (value.rows as Array<{employeeId:number}>).map(row => row.employeeId);
  if (new Set(ids).size !== ids.length) return false;
  // Ready has meaning only when every required worker is proven and no blockers exist.
  return !value.previewReady || (ids.length > 0 &&
    value.blockers.length === 0 &&
    value.rows.every((row: {blockers:string[];gross:number|null;net:number|null}) =>
      row.blockers.length === 0 && row.gross !== null && row.net !== null));
}
export async function readVerifiedFirstPayrollPreview(
  expected: FirstPayrollPreviewScope, fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<FirstPayrollPreview> {
  if (!pos(expected.organizationId)) throw bad();
  const query = new URLSearchParams({
    organizationId: String(expected.organizationId),
    periodStart: expected.periodStart, periodEnd: expected.periodEnd, payDate: expected.payDate,
  });
  const response = await fetcher("/api/first-payroll/preview?" + query, {cache:"no-store",signal});
  if (!response.ok) throw bad();
  let body: unknown;
  try { body = await response.json(); } catch { throw bad(); }
  if (!isVerifiedFirstPayrollPreview(body, expected)) throw bad();
  return body;
}
