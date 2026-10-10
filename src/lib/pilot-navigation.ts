/** A default-off, tenant-scoped pilot information architecture.
 * This affects menu visibility only; all server RBAC stays authoritative.
 */
export const PILOT_CORE_PAGES = [
  "Overview", "Payroll", "People", "Time & attendance", "Leave",
  "Approvals", "Exports", "Compliance", "Audit trail", "Settings",
  "Readiness",
] as const;

const PILOT_PAGE_SET: ReadonlySet<string> = new Set(PILOT_CORE_PAGES);

export function pilotFocusEnabledForOrganization(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return false;
  if (env.PILOT_FOCUS_NAV_ENABLED !== "true") return false;
  return (env.PILOT_FOCUS_ORG_IDS ?? "")
    .split(",").map((value) => value.trim())
    .some((value) => /^[1-9]\d*$/.test(value) && Number(value) === organizationId);
}

export function pilotCoreNavigationPages(pagesAllowedByServerRole: readonly string[]): string[] {
  return pagesAllowedByServerRole.filter((page) => PILOT_PAGE_SET.has(page));
}
