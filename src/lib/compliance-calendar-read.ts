/**
 * Scoped read of compliance deadlines and rule coverage; no aggregate may
 * display as zero, complete or clear until every source collection is verified.
 */
export type CalendarStatus =
  "complete" | "upcoming" | "due-soon" | "overdue" | "posting-pending" |
  "exception" | "verification-required" | "configuration-required";
export type CalendarItem = {
  id: string; agency: "BIR" | "SSS" | "PhilHealth" | "Pag-IBIG";
  obligation: string; applicableMonth: string; dueDate: string | null;
  status: CalendarStatus; detail: string; sourceLabel: string; sourceUrl: string;
  exactness: "nominal" | "conservative-target";
};
export type RuleWatchItem = {
  family: string; label: string;
  status: "current" | "review-due" | "verification-unrecorded" |
    "change-upcoming" | "update-overdue" | "coverage-ending" | "no-coverage";
  currentVersion: string | null; sourceDocument: string | null;
  lastVerifiedOn: string | null; detail: string;
};
export type VerifiedComplianceCalendar = {
  organizationId: number; today: string; applicableMonths: string[];
  items: CalendarItem[]; ruleWatch: RuleWatchItem[]; note: string;
};
const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const id = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const text = (x: unknown) => typeof x === "string" && x.trim().length > 0;
const optionalText = (x: unknown) => x === null || typeof x === "string";
const month = (x: unknown) => typeof x === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(x);
const date = (x: unknown) => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const stamp = Date.parse(x + "T00:00:00Z");
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === x;
};
const statuses: CalendarStatus[] = [
  "complete", "upcoming", "due-soon", "overdue", "posting-pending",
  "exception", "verification-required", "configuration-required",
];
function item(x: unknown): x is CalendarItem {
  if (!record(x)) return false;
  return text(x.id) && ["BIR","SSS","PhilHealth","Pag-IBIG"].includes(String(x.agency)) &&
    text(x.obligation) && month(x.applicableMonth) &&
    (x.dueDate === null || date(x.dueDate)) &&
    statuses.includes(x.status as CalendarStatus) &&
    text(x.detail) && text(x.sourceLabel) && text(x.sourceUrl) &&
    ["nominal", "conservative-target"].includes(String(x.exactness));
}
function rule(x: unknown): x is RuleWatchItem {
  if (!record(x)) return false;
  return text(x.family) && text(x.label) && text(x.detail) &&
    ["current","review-due","verification-unrecorded","change-upcoming",
      "update-overdue","coverage-ending","no-coverage"].includes(String(x.status)) &&
    optionalText(x.currentVersion) && optionalText(x.sourceDocument) &&
    (x.lastVerifiedOn === null || date(x.lastVerifiedOn));
}
export function isVerifiedComplianceCalendar(
  x: unknown, organizationId: number,
): x is VerifiedComplianceCalendar {
  if (!id(organizationId) || !record(x) || x.organizationId !== organizationId ||
      !date(x.today) || !text(x.note) ||
      !Array.isArray(x.applicableMonths) || !x.applicableMonths.every(month) ||
      !Array.isArray(x.items) || !x.items.every(item) ||
      !Array.isArray(x.ruleWatch) || !x.ruleWatch.every(rule)) return false;
  return new Set((x.items as CalendarItem[]).map(row => row.id)).size === x.items.length;
}
export async function readVerifiedComplianceCalendar(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedComplianceCalendar> {
  if (!id(organizationId)) throw Error("Compliance calendar unavailable: invalid employer.");
  const response = await fetcher("/api/compliance/calendar?organizationId=" + organizationId,
    { cache: "no-store", signal });
  if (!response.ok) throw Error("Compliance calendar unavailable. Retry.");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw Error("Compliance calendar returned malformed JSON. Retry."); }
  if (!isVerifiedComplianceCalendar(value, organizationId)) {
    throw Error("Compliance calendar incomplete or for another employer. Retry.");
  }
  return value;
}
