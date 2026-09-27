import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { invoices, organizations, subscriptions } from "../src/db/schema";
import { recordAuditEvent } from "../src/lib/audit";
import { PLAN_FEATURES, type PlanId } from "../src/lib/billing-matrix";

/**
 * Operator-only tool for pilot launches with no live payment processor.
 *
 * This is deliberately a script that requires DATABASE_URL, not an HTTP
 * endpoint. There is no platform-operator role in this codebase (user roles
 * are all scoped to a single organization), so an API route for this would
 * either need a new privilege tier or trust a request-supplied flag: both
 * are the wrong things to ship quickly. Someone who can run this already
 * has full database access, so it adds no new attack surface.
 *
 * Use case: an SME pays you by GCash/bank transfer instead of through
 * PayMongo. You confirm the transfer yourself, then run this to flip their
 * plan to active and record a paid invoice: same effect as a successful
 * checkout, so getEntitlements()/requireFeature() treat them identically to
 * a PayMongo customer. Nothing here bypasses tenant isolation or auth.
 *
 * Usage:
 *   npx tsx scripts/manual-activate-subscription.ts \
 *     --org 3 --plan Core --cycle monthly \
 *     --amount 1500 --note "GCash transfer, ref 123456, received 2026-09-23"
 *
 * --org      organization id (required)
 * --plan     Solo | Core | Scale | Enterprise (required)
 * --cycle    monthly | annual (default: monthly)
 * --amount   amount actually collected, in PHP (required: write what was
 *            really paid, not the list price, so the invoice ledger stays honest)
 * --note     free-text reference for the audit trail (required)
 * --months   how many billing periods this covers (default: 1)
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const organizationId = Number(arg("org"));
  const plan = arg("plan") as PlanId | undefined;
  const cycle = (arg("cycle") ?? "monthly") as "monthly" | "annual";
  const amountPhp = Number(arg("amount"));
  const note = arg("note");
  const months = Number(arg("months") ?? "1");

  if (!organizationId || !plan || !(plan in PLAN_FEATURES)) {
    throw new Error("Usage: --org <id> --plan <Solo|Core|Scale|Enterprise> --amount <php> --note \"...\" [--cycle monthly|annual] [--months 1]");
  }
  if (!amountPhp || amountPhp < 0) throw new Error("--amount is required and must be the PHP amount actually collected (0 is fine for Solo).");
  if (!note) throw new Error("--note is required. Record how and when payment was confirmed, for the audit trail.");

  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new Error(`No organization with id ${organizationId}.`);

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + (cycle === "annual" ? 12 * months : months));

  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);

  const values = {
    organizationId,
    plan,
    status: "active" as const,
    billingCycle: cycle,
    amountCents: Math.round(amountPhp * 100),
    currency: "PHP",
    periodStart: now,
    periodEnd,
    provider: "manual",
    providerRef: note,
    cancelledAt: null,
  };

  const seatLimit = existing?.seatLimit ?? 10;
  const subscription = existing
    ? (await db.update(subscriptions).set(values).where(eq(subscriptions.id, existing.id)).returning())[0]
    : (await db.insert(subscriptions).values({ ...values, seatLimit }).returning())[0];

  const invoiceNumber = `MANUAL-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
  const [invoice] = await db.insert(invoices).values({
    organizationId,
    subscriptionId: subscription.id,
    number: invoiceNumber,
    amountCents: Math.round(amountPhp * 100),
    currency: "PHP",
    status: "paid",
    periodStart: now.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    paidAt: now,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: "operator:manual-activation-script",
    action: "subscription.manually_activated",
    resource: `subscription:${subscription.id}`,
    metadata: { plan, cycle, amountPhp, note, invoiceNumber },
  });

  console.log(`Activated ${org.name} (org ${organizationId}) on ${plan}/${cycle} through ${periodEnd.toISOString().slice(0, 10)}.`);
  console.log(`Recorded invoice ${invoice.number} for ₱${amountPhp}. Status: paid, provider: manual.`);
  console.log("This organization's entitlements are now identical to a PayMongo-paid customer.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
