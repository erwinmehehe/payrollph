/** Disclosure preferences never grant permissions or disable payroll controls. */
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
export const CORE_NAVIGATION_PAGES = ["Overview", "People", "Time & attendance", "Payroll", "Approvals", "Settings"] as const;
export const TENANT_MODULES = [
  { id: "workforce", title: "Workforce and leave", detail: "Rosters, rotations and leave administration.", pages: ["Workforce", "Leave"] },
  { id: "planning", title: "Planning and compensation", detail: "Headcount plans, positions and salary reviews.", pages: ["Planning", "Compensation"] },
  { id: "people-operations", title: "People operations", detail: "Recruitment, documents, performance and employee lifecycle.", pages: ["Recruitment", "Documents", "Performance", "Discipline", "Separation", "Contractors"] },
  { id: "spend", title: "Spend and benefits", detail: "Expenses, advances, loans, benefits and allowances.", pages: ["Expenses", "Earned wage", "Loans", "Benefits", "De minimis"] },
  { id: "it", title: "IT operations", detail: "Employee equipment and managed devices.", pages: ["Assets"] },
  { id: "automation", title: "Automation and integrations", detail: "Workflows, connected systems and developer tools.", pages: ["Automation", "Integrations", "Developer"] },
  { id: "enterprise", title: "Enterprise controls", detail: "Legal employers, access policies, audit and launch evidence.", pages: ["Enterprise", "Readiness", "Audit trail", "Pricing"] },
  { id: "migration", title: "Migration", detail: "Historical payroll and HRIS migration tools.", pages: ["Migration"] },
  { id: "compliance", title: "Compliance", detail: "Statutory calendars, evidence and filing administration.", pages: ["Compliance"] },
] as const;
export type TenantModuleId = typeof TENANT_MODULES[number]["id"];
export type TenantModulePreferences = { mode: "core" | "all"; enabledModules: string[] };
export function isTenantModuleId(value: unknown): value is TenantModuleId {
  return typeof value === "string" && TENANT_MODULES.some(m => m.id === value);
}
export function tenantModulePages(enabledModules: readonly string[]): Set<string> {
  return new Set(TENANT_MODULES.filter(m => enabledModules.includes(m.id)).flatMap(m => [...m.pages]));
}

/** Optional columns must never enter ordinary organization SELECT/INSERT projections. */
export async function loadTenantModulePreferences(
  organizationIds: readonly number[],
  read: () => Promise<readonly { id: number; mode: unknown; enabledModules: unknown }[]>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Map<number, TenantModulePreferences>> {
  const result = new Map<number, TenantModulePreferences>();
  if (!criticalReleaseFlagEnabled("coreModuleNavigation", env) || organizationIds.length === 0) return result;
  const allowed = new Set(organizationIds);
  for (const row of await read()) {
    if (!allowed.has(row.id)) continue;
    result.set(row.id, {
      mode: row.mode === "core" ? "core" : "all",
      enabledModules: Array.isArray(row.enabledModules) ? row.enabledModules.filter(isTenantModuleId) : [],
    });
  }
  return result;
}
