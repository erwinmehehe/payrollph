import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, organizations, subscriptions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, BILLING_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getEntitlements, type PlanId } from "@/lib/billing";
import { createPaymongoCheckout } from "@/lib/paymongo";

export const dynamic = "force-dynamic";

const PLAN_BASE_PRICES: Record<PlanId, number> = {
  Solo: 0,
  Core: 1_500,
  Scale: 4_499,
  Enterprise: 12_999,
};

const isPlan = (value: string): value is PlanId => value in PLAN_BASE_PRICES;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    BILLING_ADMIN_ROLES,
    "Only billing administrators can view or change subscription billing.",
  );
  if (denied) return denied;

  const [entitlements, invoiceList, [org]] = await Promise.all([
    getEntitlements(organizationId),
    db.select().from(invoices).where(eq(invoices.organizationId, organizationId)).orderBy(desc(invoices.createdAt)).limit(10),
    db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
  ]);

  return Response.json({
    entitlements,
    invoices: invoiceList,
    organization: org,
    provider: process.env.PAYMONGO_SECRET_KEY ? "paymongo" : "not_configured",
    billingConfigured: Boolean(process.env.PAYMONGO_SECRET_KEY),
  });
}

/**
 * Starts a hosted PayMongo Checkout Session.
 *
 * Important: this never marks an invoice paid or activates a new plan. That can
 * only happen in a provider-verified webhook handler after payment. When no key
 * is configured, it returns a truthful 503 and writes nothing financial.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const targetPlan = String(body.plan ?? "Scale");
  const billingCycle = body.billingCycle === "annual" ? "annual" : "monthly";

  if (!isPlan(targetPlan)) return Response.json({ error: "Unknown plan." }, { status: 422 });
  if (targetPlan === "Solo") return Response.json({ error: "Solo is self-service and does not require checkout." }, { status: 422 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    BILLING_ADMIN_ROLES,
    "Only billing administrators can view or change subscription billing.",
  );
  if (denied) return denied;

  if (!process.env.PAYMONGO_SECRET_KEY) {
    return Response.json({
      error: "Billing provider is not configured. No invoice was marked paid and your plan has not changed.",
      code: "BILLING_NOT_CONFIGURED",
      nextStep: "Set PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET, then test a PayMongo Checkout Session in test mode.",
    }, { status: 503 });
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return Response.json({ error: "Organization not found." }, { status: 404 });

  const base = PLAN_BASE_PRICES[targetPlan];
  const amountPhp = billingCycle === "annual" ? base * 10 : base;
  const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;

  const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  const [invoice] = await db.insert(invoices).values({
    organizationId,
    subscriptionId: existingSub?.id ?? null,
    number: invoiceNumber,
    amountCents: amountPhp * 100,
    currency: "PHP",
    status: "open",
  }).returning();

  try {
    const origin = new URL(request.url).origin;
    const checkout = await createPaymongoCheckout({
      amountCents: invoice.amountCents,
      description: `Linaw ${targetPlan} plan · ${billingCycle}`,
      invoiceNumber,
      organizationId,
      plan: targetPlan,
      billingCycle,
      successUrl: `${origin}/?billing=success&invoice=${invoice.id}`,
      cancelUrl: `${origin}/?billing=cancelled&invoice=${invoice.id}`,
      customerName: user.name,
      customerEmail: user.email,
    });

    if (existingSub) {
      await db.update(subscriptions).set({
        status: "pending_payment",
        provider: "paymongo",
        providerRef: checkout.id,
        amountCents: invoice.amountCents,
        billingCycle,
      }).where(eq(subscriptions.id, existingSub.id));
    } else {
      await db.insert(subscriptions).values({
        organizationId,
        plan: targetPlan,
        status: "pending_payment",
        seatLimit: 10,
        amountCents: invoice.amountCents,
        billingCycle,
        provider: "paymongo",
        providerRef: checkout.id,
      });
    }

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Checkout session created",
      resource: `${targetPlan} Plan (${billingCycle})`,
      metadata: { invoiceNumber, invoiceId: invoice.id, provider: "paymongo", checkoutId: checkout.id },
    });

    return Response.json({
      ok: true,
      invoice: { id: invoice.id, number: invoice.number, status: "open" },
      checkoutUrl: checkout.checkoutUrl,
      message: "Checkout created. Your plan activates only after PayMongo confirms payment by webhook.",
    }, { status: 201 });
  } catch (error) {
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Checkout session failed",
      resource: invoiceNumber,
      metadata: { error: error instanceof Error ? error.message : "unknown" },
    });
    return Response.json({
      error: error instanceof Error ? error.message : "Could not create checkout.",
      invoice: { id: invoice.id, number: invoice.number, status: "open" },
      code: "CHECKOUT_PROVIDER_ERROR",
    }, { status: 502 });
  }
}
