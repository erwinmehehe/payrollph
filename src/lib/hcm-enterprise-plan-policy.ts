/**
 * Exact-employer, opt-in Enterprise route gate. Not a substitute for RBAC,
 * permission sets, legal-employer selection or existing HCM rollout flags.
 */
export type HcmEnterprisePlanDecision =
  | "not-enforced"
  | "allowed"
  | "subscription-inactive"
  | "subscription-missing"
  | "enterprise-required"
  | "entitlements-unavailable";

export type HcmPlanSnapshot = {
  plan: string;
  active: boolean;
  status: string;
  features: readonly string[];
};
export type HcmPlanEnv = Readonly<Record<string, string | undefined>>;

function positiveEmployerId(text: string): number | null {
  if (!/^[1-9][0-9]*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

export function enterpriseHcmPlanGateEnabled(
  organizationId: number,
  env: HcmPlanEnv,
): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return false;
  if (env.HCM_ENTERPRISE_PLAN_GATE_ENABLED !== "true") return false;
  return (env.HCM_ENTERPRISE_PLAN_GATE_ORG_IDS ?? "").split(",").some(
    (id) => positiveEmployerId(id.trim()) === organizationId,
  );
}

/** Call only AFTER existing actor/tenant/permission authorization. */
export function evaluateEnterpriseHcmPlan(
  organizationId: number,
  snapshot: HcmPlanSnapshot | null,
  env: HcmPlanEnv,
): HcmEnterprisePlanDecision {
  if (!enterpriseHcmPlanGateEnabled(organizationId, env)) return "not-enforced";
  if (!snapshot) return "entitlements-unavailable";
  // The billing helper may infer an Enterprise plan from the account type
  // even if no subscription exists. That cannot bypass a route paywall.
  if (snapshot.status === "none") return "subscription-missing";
  if (!snapshot.active) return "subscription-inactive";
  if (snapshot.plan !== "Enterprise" ||
      !snapshot.features.includes("advanced-hcm-discovery")) return "enterprise-required";
  return "allowed";
}

export async function resolveEnterpriseHcmPlan(
  organizationId: number,
  env: HcmPlanEnv,
  loadEntitlements: (organizationId: number) => Promise<HcmPlanSnapshot | null>,
): Promise<HcmEnterprisePlanDecision> {
  // No billing lookup, disruption or additional cost for existing employers.
  if (!enterpriseHcmPlanGateEnabled(organizationId, env)) return "not-enforced";
  try {
    return evaluateEnterpriseHcmPlan(
      organizationId,
      await loadEntitlements(organizationId),
      env,
    );
  } catch {
    // No leaking provider exception text or defaulting to an inferred plan.
    return "entitlements-unavailable";
  }
}
