import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, subscriptions } from "@/db/schema";
import { PLAN_FEATURES, type Entitlements, type PlanId } from "@/lib/billing-matrix";
import { paidAccessAllowed } from "@/lib/saas-pricing";

export { PLAN_FEATURES, hasFeature, requireFeature } from "@/lib/billing-matrix";
export type { PlanId, Entitlements } from "@/lib/billing-matrix";

/**
 * Single source of truth for what an organization may do.
 * Read on the request path, a plan limit is enforced here, not in the UI.
 * A billing provider (PayMongo / Maya / Stripe) only needs to write to the
 * subscriptions table; entitlements follow automatically.
 */
export async function getEntitlements(organizationId: number): Promise<Entitlements> {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);

  // No subscription row yet: infer the cheapest viable plan from account type
  // so a brand-new workspace is never accidentally locked out of its own data.
  const inferred: PlanId = organization?.accountType === "freelancer"
    ? "Solo"
    : organization?.accountType === "enterprise" ? "Enterprise" : "Core";

  const plan = (subscription?.plan as PlanId | undefined) ?? inferred;
  const now = Date.now();
  const trialEnds = subscription?.trialEndsAt ? new Date(subscription.trialEndsAt).getTime() : null;
  const inTrial = subscription?.status === "trialing" && trialEnds != null && trialEnds > now;

  return {
    plan,
    features: PLAN_FEATURES[plan] ?? PLAN_FEATURES.Core,
    seatLimit: subscription?.seatLimit ?? null,
    status: subscription?.status ?? "none",
    trialing: subscription?.status === "trialing",
    inTrial,
    active: subscription?.provider === "xendit"
      ? paidAccessAllowed({ status: subscription.status, paidThrough: subscription.periodEnd })
      : subscription ? subscription.status === "active" || inTrial : true,
    provider: subscription?.provider ?? null,
  };
}

/** Seat enforcement: true when adding one more employee would exceed the plan. */
export async function seatUsage(organizationId: number, seatLimit: number | null) {
  const [{ value }] = await db.select({ value: count() }).from(employees).where(eq(employees.organizationId, organizationId));
  if (seatLimit == null) return { used: value, limit: null as number | null, atLimit: false, remaining: null as number | null };
  return { used: value, limit: seatLimit, atLimit: value >= seatLimit, remaining: Math.max(0, seatLimit - value) };
}

export async function ensureSubscription(organizationId: number, trialDays = 14) {
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(subscriptions).values({
    organizationId,
    plan: "Core",
    status: "trialing",
    seatLimit: 10,
    trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
    periodStart: new Date(),
  }).returning();
  return created;
}
