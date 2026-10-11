import type { Entitlements } from "./billing-matrix";
import type { HcmNavigationLink } from "./hcm-context-navigation";

/**
 * An Enterprise-only DISCOVERY affordance, never an authorization grant.
 * The destination pages/APIs retain independent tenant, role, permission-set
 * and server flag enforcement. Other plans retain their preexisting routes.
 */
export function canDiscoverAdvancedHcm(
  access: { role: string; companyWide: boolean } | null | undefined,
  entitlements: Pick<Entitlements, "plan" | "active" | "features"> | null | undefined,
): boolean {
  if (!access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) return false;
  if (!entitlements?.active || entitlements.plan !== "Enterprise") return false;
  return entitlements.features.includes("advanced-hcm-discovery");
}

const ADVANCED_IDS = new Set<HcmNavigationLink["id"]>([
  "actionCenter", "orgExplorer", "processMonitor",
]);

/** Links are derived from actual server-enabled HCM source navigation. */
export function advancedHcmLinks(
  access: { role: string; companyWide: boolean } | null | undefined,
  entitlements: Pick<Entitlements, "plan" | "active" | "features"> | null | undefined,
  available: readonly HcmNavigationLink[],
): HcmNavigationLink[] {
  return canDiscoverAdvancedHcm(access, entitlements)
    ? available.filter((link) => ADVANCED_IDS.has(link.id))
    : [];
}
