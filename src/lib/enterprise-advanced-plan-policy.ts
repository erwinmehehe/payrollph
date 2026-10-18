import { enterpriseHcmPlanGateEnabled, type HcmPlanEnv, type HcmPlanSnapshot } from "./hcm-enterprise-plan-policy";

/** Existing exact-employer opt-in flags, no new production configuration. */
export type AdvancedHcmModule = "planning" | "compensation";
export type AdvancedHcmPlanDecision =
  | "not-enforced" | "allowed" | "missing-subscription"
  | "inactive-subscription" | "enterprise-required" | "entitlements-unavailable";

const MODULE_FEATURE: Record<AdvancedHcmModule, string> = {
  planning: "advanced-workforce-planning",
  compensation: "advanced-compensation-configuration",
};

/**
 * Read only after the route's session, tenant membership, role, custom-deny
 * and unit/scope authorization have already passed. An inferred plan without
 * an actual subscription row cannot grant an enrolled Enterprise feature.
 */
export function evaluateAdvancedHcmPlan(
  organizationId: number,
  module: AdvancedHcmModule,
  snapshot: HcmPlanSnapshot | null,
  env: HcmPlanEnv,
): AdvancedHcmPlanDecision {
  if (!enterpriseHcmPlanGateEnabled(organizationId, env)) return "not-enforced";
  if (!snapshot) return "entitlements-unavailable";
  if (snapshot.status === "none") return "missing-subscription";
  if (!snapshot.active) return "inactive-subscription";
  if (snapshot.plan !== "Enterprise" ||
      !snapshot.features.includes(MODULE_FEATURE[module])) return "enterprise-required";
  return "allowed";
}

export async function resolveAdvancedHcmPlan(
  organizationId: number,
  module: AdvancedHcmModule,
  env: HcmPlanEnv,
  load: (organizationId: number) => Promise<HcmPlanSnapshot | null>,
): Promise<AdvancedHcmPlanDecision> {
  // A default-OFF/non-enrolled employer incurs ZERO billing calls.
  if (!enterpriseHcmPlanGateEnabled(organizationId, env)) return "not-enforced";
  try {
    return evaluateAdvancedHcmPlan(organizationId, module, await load(organizationId), env);
  } catch {
    // Provider errors or incomplete account records fail closed, without logs.
    return "entitlements-unavailable";
  }
}
