import { getEntitlements } from "@/lib/billing";
import { resolveAdvancedHcmPlan, type AdvancedHcmModule } from "@/lib/enterprise-advanced-plan-policy";

/** Supplementary exact-employer paid feature gate, never replaces server RBAC. */
export async function denyOptInEnterpriseAdvancedPlan(
  organizationId: number,
  module: AdvancedHcmModule,
): Promise<Response | null> {
  const decision = await resolveAdvancedHcmPlan(organizationId, module, process.env, getEntitlements);
  if (decision === "not-enforced" || decision === "allowed") return null;
  const unavailable = decision === "entitlements-unavailable";
  return Response.json({
    error: unavailable
      ? "Enterprise entitlement information is unavailable. Try again later."
      : "An active Enterprise subscription is required for this advanced workspace.",
    code: unavailable ? "ENTERPRISE_ENTITLEMENTS_UNAVAILABLE" : "ENTERPRISE_ADVANCED_PLAN_REQUIRED",
  }, { status: unavailable ? 503 : 402, headers: { "Cache-Control": "private, no-store" } });
}
