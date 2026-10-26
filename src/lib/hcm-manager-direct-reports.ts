/**
 * Manager-only current direct reports. This is NOT the broader unit-scoped
 * HR/My Team directory or a historical reporting hierarchy.
 */
export const MANAGER_DIRECT_REPORTS_PAGE_SIZE = 20;

export type ManagerDirectReport = {
  assignmentId: number;
  employeeNo: string;
  name: string;
  status: string;
  positionCode: string;
  reportingUnitId: number;
  reportingUnitName: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type ManagerDirectReportsPayload = {
  organizationId: number;
  observedAt: string;
  asOfDate: string;
  scope: { kind: "verified_direct_reports"; orgUnitId: number };
  items: ManagerDirectReport[];
  page: { size: 20; hasMore: boolean; nextCursor: number | null };
  warning: string;
};

/** Reject ambiguous IDs before they are passed to SQL or a selected employer. */
export function canonicalManagerTeamId(value: string | null, allowZero = false): number | null {
  const pattern = allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/;
  if (value === null || !pattern.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && (allowZero ? number >= 0 : number > 0)
    ? number : null;
}

/**
 * An explicitly authorized legal employer is required; no global on-switch
 * may accidentally activate the feature for other clients.
 */
export function managerDirectReportsEnabledForEmployer(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId < 1 ||
      env.HCM_MANAGER_TEAM_ENABLED !== "true") return false;
  return (env.HCM_MANAGER_TEAM_ORG_IDS ?? "").split(",").some((value) =>
    canonicalManagerTeamId(value.trim()) === organizationId);
}

/** Managers must have a current, verified exact-unit membership. */
export function managerDirectReportsUnitId(
  access: { role: string; companyWide: boolean; orgUnitId: number | null } | null,
): number | null {
  if (access?.role !== "manager" || access.companyWide ||
      !Number.isSafeInteger(access.orgUnitId) ||
      access.orgUnitId === null || access.orgUnitId < 1) return null;
  return access.orgUnitId;
}

/** PH business date, never the machine's UTC date at the Manila boundary. */
export function managerDirectReportsBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const find = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return [find("year"), find("month"), find("day")].join("-");
}
