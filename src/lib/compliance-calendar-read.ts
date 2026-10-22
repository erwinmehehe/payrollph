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
const REQUIRED_RULE_WATCH_LABELS = {
  sss: "SSS contribution schedule",
  philhealth: "PhilHealth premium schedule",
  pagibig: "Pag-IBIG contribution rules",
  "bir-withholding": "BIR withholding tax tables",
  "wage-orders": "Regional minimum wage orders",
} as const;
export type RuleWatchFamily = keyof typeof REQUIRED_RULE_WATCH_LABELS;
export type RuleWatchItem = {
  family: RuleWatchFamily; label: string;
  status: "current" | "review-due" | "verification-unrecorded" |
    "change-upcoming" | "update-overdue" | "coverage-ending" | "no-coverage";
  currentVersion: string | null; sourceDocument: string | null;
  lastVerifiedOn: string | null; detail: string;
};
export type VerifiedComplianceCalendar = {
  organizationId: number; today: string; applicableMonths: string[];
  payrollMonths: string[]; birMonths: string[]; annualTaxYears: number[];
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
  return text(x.family) && Object.prototype.hasOwnProperty.call(REQUIRED_RULE_WATCH_LABELS, x.family) &&
    text(x.label) && text(x.detail) &&
    ["current","review-due","verification-unrecorded","change-upcoming",
      "update-overdue","coverage-ending","no-coverage"].includes(String(x.status)) &&
    optionalText(x.currentVersion) && optionalText(x.sourceDocument) &&
    (x.lastVerifiedOn === null || date(x.lastVerifiedOn));
}
function completeRuleWatch(watch: RuleWatchItem[]): boolean {
  const identities = new Set(watch.map(row => row.family + "|" + row.label));
  return identities.size === watch.length &&
    Object.entries(REQUIRED_RULE_WATCH_LABELS).every(([family, label]) =>
      watch.some(row => row.family === family && row.label === label));
}
function completeObligations(calendar: VerifiedComplianceCalendar): boolean {
  const { applicableMonths, payrollMonths, birMonths, annualTaxYears, today, items } = calendar;
  const uniqueMonths = (months: string[]) =>
    months.length === new Set(months).size && months.every(month);
  if (!uniqueMonths(applicableMonths) || !uniqueMonths(payrollMonths) ||
      !uniqueMonths(birMonths) || annualTaxYears.length !== new Set(annualTaxYears).size ||
      !annualTaxYears.every((year) => Number.isSafeInteger(year) && year >= 2000 && year <= 2100)) return false;
  const expectedMonths = new Set([...payrollMonths, ...birMonths]);
  if (expectedMonths.size !== applicableMonths.length ||
      applicableMonths.some((m) => !expectedMonths.has(m))) return false;
  const windowYear = Number(today.slice(0, 4)) -
    (Number(today.slice(5, 7)) <= 4 ? 1 : 0);
  if (Number(today.slice(5, 7)) >= 5 && Number(today.slice(5, 7)) <= 10 &&
      annualTaxYears.length > 0) return false;
  if (annualTaxYears.some((year) => year !== windowYear)) return false;
  if (birMonths.some((m) => Number(m.slice(0, 4)) === windowYear) &&
      (Number(today.slice(5, 7)) >= 11 || Number(today.slice(5, 7)) <= 4) &&
      !annualTaxYears.includes(windowYear)) return false;
  const expected = new Map<string, { agency: CalendarItem["agency"]; month: string }>();
  for (const m of payrollMonths) for (const agency of ["SSS", "PhilHealth", "Pag-IBIG"] as const)
    expected.set(`${agency}-${m}`, { agency, month: m });
  for (const m of birMonths) expected.set(`BIR-1601C-${m}`, { agency: "BIR", month: m });
  for (const year of annualTaxYears) {
    for (const code of ["2316-EMPLOYEE", "1604C", "2316-BIR"])
      expected.set(`BIR-${code}-${year}`, { agency: "BIR", month: `${year}-12` });
  }
  return items.length === expected.size && items.every((item) => {
    const required = expected.get(item.id);
    return required?.agency === item.agency && required.month === item.applicableMonth;
  });
}
export function isVerifiedComplianceCalendar(
  x: unknown, organizationId: number,
): x is VerifiedComplianceCalendar {
  if (!id(organizationId) || !record(x) || x.organizationId !== organizationId ||
      !date(x.today) || !text(x.note) ||
      !Array.isArray(x.applicableMonths) || !x.applicableMonths.every(month) ||
      !Array.isArray(x.payrollMonths) || !x.payrollMonths.every(month) ||
      !Array.isArray(x.birMonths) || !x.birMonths.every(month) ||
      !Array.isArray(x.annualTaxYears) ||
      !Array.isArray(x.items) || !x.items.every(item) ||
      !Array.isArray(x.ruleWatch) || !x.ruleWatch.every(rule)) return false;
  return new Set((x.items as CalendarItem[]).map(row => row.id)).size === x.items.length &&
    completeObligations(x as VerifiedComplianceCalendar) &&
    completeRuleWatch(x.ruleWatch as RuleWatchItem[]);
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
