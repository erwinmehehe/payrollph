export type PlanId = "Solo" | "Core" | "Scale" | "Enterprise";

/** Cumulative feature matrix. Order matters: each tier includes the previous. */
export const PLAN_FEATURES: Record<PlanId, string[]> = {
  Solo: ["self-service"],
  Core: ["payroll", "time", "government-drafts", "self-service"],
  Scale: ["payroll", "time", "government-drafts", "self-service", "multi-branch", "approvals", "api", "imports"],
  Enterprise: [
    "payroll", "time", "government-drafts", "self-service",
    "multi-branch", "approvals", "api", "imports",
    "audit-export", "bi-exports", "priority-sla",
  ],
};

export type Entitlements = {
  plan: PlanId;
  features: string[];
  seatLimit: number | null;
  status: string;
  trialing: boolean;
  inTrial: boolean;
  active: boolean;
  provider: string | null;
};

export function hasFeature(entitlements: Entitlements, feature: string) {
  return entitlements.features.includes(feature);
}

/**
 * Guard for API routes. 402 (payment required) when the plan lacks the module,
 * or when the subscription is not in a payable state.
 */
export function requireFeature(entitlements: Entitlements, feature: string): Response | null {
  // Payment state is checked BEFORE plan features. Otherwise a cancelled or
  // past-due workspace would keep working for every feature its plan includes.
  if (!entitlements.active) {
    return Response.json({
      error: `This workspace's subscription is ${entitlements.status}. Reactivate billing to continue using ${feature}.`,
      plan: entitlements.plan,
      feature,
      subscriptionState: entitlements.status,
    }, { status: 402 });
  }
  if (hasFeature(entitlements, feature)) return null;
  const paid = feature === "imports" || feature === "api" || feature === "multi-branch" ? "Scale" : "Enterprise";
  return Response.json({
    error: `The ${feature} module is not part of the ${entitlements.plan} plan.`,
    plan: entitlements.plan,
    feature,
    upgradeTo: paid,
  }, { status: 402 });
}
