import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pricingPlans } from "@/db/schema";

export const DEFAULT_PRICING_PLANS = [
  {
    name: "Solo",
    monthlyBase: "0",
    perEmployee: "0",
    modules: ["Voluntary contributions", "Tax planner"],
    version: "2026.1",
    active: true,
  },
  {
    name: "Core",
    monthlyBase: "1500",
    perEmployee: "50",
    modules: ["Payroll", "Time", "Government drafts"],
    version: "2026.1",
    active: true,
  },
  {
    name: "Scale",
    monthlyBase: "4499",
    perEmployee: "79",
    modules: ["Core", "Multi-branch", "Approvals", "API"],
    version: "2026.1",
    active: true,
  },
  {
    name: "Enterprise",
    monthlyBase: "12999",
    perEmployee: "99",
    modules: ["Scale", "SSO-ready", "BI exports", "Priority SLA"],
    version: "2026.1",
    active: true,
  },
] as const;

/**
 * Public pricing is application configuration stored in pricing_plans.
 *
 * Production databases created before public pricing shipped can legitimately
 * have an empty pricing_plans table. Bootstrap the canonical rows exactly once
 * under a PostgreSQL transaction advisory lock, then always render what is in
 * the database.
 */
export async function getPublicPricingPlans() {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(731942611)`);

    let plans = await tx
      .select()
      .from(pricingPlans)
      .where(eq(pricingPlans.active, true))
      .orderBy(asc(pricingPlans.id));

    if (plans.length === 0) {
      await tx.insert(pricingPlans).values(DEFAULT_PRICING_PLANS.map((plan) => ({ ...plan })));
      plans = await tx
        .select()
        .from(pricingPlans)
        .where(eq(pricingPlans.active, true))
        .orderBy(asc(pricingPlans.id));
    }

    return plans;
  });
}
