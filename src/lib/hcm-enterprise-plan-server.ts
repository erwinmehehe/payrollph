import { getEntitlements } from "@/lib/billing";
import { resolveEnterpriseHcmPlan } from "@/lib/hcm-enterprise-plan-policy";

/**
 * Supplementary opted-in billing gate. Invoke after all existing actor,
 * legal-employer, unit-scope, feature flag and permission-set checks.
 */
export async function denyOptInEnterpriseHcmPlan(
  organizationId: number,
): Promise<Response | null> {
  const decision = await resolveEnterpriseHcmPlan(
    organizationId,
    process.env,
    getEntitlements,
  );
  if (decision === "not-enforced" || decision === "allowed") return null;
  if (decision === "entitlements-unavailable") {
    return Response.json(
      { error: "Enterprise HCM subscription information is unavailable.", code: "HCM_ENTITLEMENTS_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return Response.json(
    { error: "An active Enterprise subscription is required for this HCM workspace.", code: "HCM_ENTERPRISE_PLAN_REQUIRED" },
    { status: 402, headers: { "Cache-Control": "private, no-store" } },
  );
}
