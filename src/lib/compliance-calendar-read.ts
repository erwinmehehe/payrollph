export type CalendarStatus = "complete" | "upcoming" | "due-soon" | "overdue" |
  "posting-pending" | "exception" | "verification-required" | "configuration-required";
export type RuleWatchStatus = "current" | "review-due" | "verification-unrecorded" |
  "change-upcoming" | "update-overdue" | "coverage-ending" | "no-coverage";
export type CalendarItem = {
  id: string; agency: "BIR" | "SSS" | "PhilHealth" | "Pag-IBIG";
  obligation: string; applicableMonth: string; dueDate: string | null;
  status: CalendarStatus; detail: string; sourceLabel: string; sourceUrl: string;
  exactness: "nominal" | "conservative-target";
};
export type RuleWatchItem = {
  family: string; label: string; status: RuleWatchStatus;
  currentVersion: string | null; sourceDocument: string | null; lastVerifiedOn: string | null; detail: string;
};
export type CalendarPayload = {
  organizationId: number; today: string; applicableMonths: string[];
  contributionMonths: string[]; birPayMonths: string[];
  items: CalendarItem[]; ruleWatch: RuleWatchItem[]; note: string;
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isoDay = (v: unknown): v is string => {
  if (!text(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(v + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
};
const isoMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const optionalText = (v: unknown) => v === null || typeof v === "string";
const calendarStatuses = new Set<CalendarStatus>([
  "complete", "upcoming", "due-soon", "overdue", "posting-pending",
  "exception", "verification-required", "configuration-required",
]);
const watchStatuses = new Set<RuleWatchStatus>([
  "current", "review-due", "verification-unrecorded", "change-upcoming",
  "update-overdue", "coverage-ending", "no-coverage",
]);
function calendarItem(v: unknown): v is CalendarItem {
  return record(v) && text(v.id) &&
    ["BIR", "SSS", "PhilHealth", "Pag-IBIG"].includes(String(v.agency)) &&
    text(v.obligation) && isoMonth(v.applicableMonth) &&
    (v.dueDate === null || isoDay(v.dueDate)) && calendarStatuses.has(v.status as CalendarStatus) &&
    text(v.detail) && text(v.sourceLabel) && text(v.sourceUrl) &&
    (v.exactness === "nominal" || v.exactness === "conservative-target");
}
function watchItem(v: unknown): v is RuleWatchItem {
  return record(v) && text(v.family) && text(v.label) &&
    watchStatuses.has(v.status as RuleWatchStatus) &&
    optionalText(v.currentVersion) && optionalText(v.sourceDocument) &&
    (v.lastVerifiedOn === null || isoDay(v.lastVerifiedOn)) && text(v.detail);
}
/** A calendar with missing results or missing rules is unavailable, never "all clear". */
export function parseVerifiedComplianceCalendar(value: unknown, organizationId: number): CalendarPayload | null {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !record(value) || value.organizationId !== organizationId || !isoDay(value.today) ||
      !Array.isArray(value.applicableMonths) || !value.applicableMonths.every(isoMonth) ||
      !Array.isArray(value.contributionMonths) || !value.contributionMonths.every(isoMonth) ||
      !Array.isArray(value.birPayMonths) || !value.birPayMonths.every(isoMonth) ||
      !Array.isArray(value.items) || !value.items.every(calendarItem) ||
      !Array.isArray(value.ruleWatch) || !value.ruleWatch.every(watchItem) ||
      !text(value.note)) return null;
  const items = value.items as CalendarItem[];
  const watch = value.ruleWatch as RuleWatchItem[];
  if (new Set(items.map(x => x.id)).size !== items.length ||
      new Set(watch.map(x => JSON.stringify([x.family, x.label, x.sourceDocument]))).size !== watch.length)
    return null;

  // These five source-status families are always produced by the server,
  // including when there are no payroll runs. An empty ruleWatch is not an
  // authoritative all-clear, even if the HTTP status is 200.
  const requiredFamilies = ["sss", "philhealth", "pagibig", "bir-withholding", "wage-orders"];
  if (!requiredFamilies.every(family => watch.some(entry => entry.family === family)))
    return null;

  // Server-issued source months are distinct: a BIR entry cannot excuse
  // missing SSS, PhilHealth or Pag-IBIG items for a payroll-period month.
  const months = value.applicableMonths as string[];
  const contributionMonths = value.contributionMonths as string[];
  const birPayMonths = value.birPayMonths as string[];
  const union = new Set([...contributionMonths, ...birPayMonths]);
  if (new Set(months).size !== months.length ||
      new Set(contributionMonths).size !== contributionMonths.length ||
      new Set(birPayMonths).size !== birPayMonths.length ||
      months.length !== union.size || months.some(month => !union.has(month)) ||
      (months.length === 0 && items.length !== 0)) return null;

  const contributionAgencies = ["SSS", "PhilHealth", "Pag-IBIG"] as const;
  for (const month of contributionMonths) {
    for (const agency of contributionAgencies) {
      if (!items.some(item => item.id === agency + "-" + month &&
          item.agency === agency && item.applicableMonth === month)) return null;
    }
  }
  for (const month of birPayMonths) {
    if (!items.some(item => item.id === "BIR-1601C-" + month &&
        item.agency === "BIR" && item.applicableMonth === month)) return null;
  }
  // Reject orphan and misbound monthly entries; annual BIR items remain valid.
  for (const item of items) {
    if (item.agency !== "BIR" && (!contributionMonths.includes(item.applicableMonth) ||
        item.id !== item.agency + "-" + item.applicableMonth)) return null;
    if (item.id.startsWith("BIR-1601C-") &&
        (!birPayMonths.includes(item.applicableMonth) ||
         item.id !== "BIR-1601C-" + item.applicableMonth || item.agency !== "BIR")) return null;
  }
  return value as CalendarPayload;
}
export async function readVerifiedComplianceCalendar(
  organizationId: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CalendarPayload> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    throw Error("Compliance calendar unavailable. Retry.");
  const response = await fetcher("/api/compliance/calendar?organizationId=" + organizationId,
    { cache: "no-store", signal });
  if (!response.ok) throw Error("Compliance calendar unavailable. Retry.");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw Error("Compliance calendar unreadable. Retry."); }
  const verified = parseVerifiedComplianceCalendar(value, organizationId);
  if (!verified) throw Error("Compliance calendar incomplete or for a different employer. Retry.");
  return verified;
}
