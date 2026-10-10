import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { organizations, subscriptions } from "@/db/schema";
import { saasBillingCheckouts } from "@/lib/saas-billing-schema";
import { getSessionUser } from "@/lib/auth";
import { BILLING_ADMIN_ROLES, assertOrganizationRole, getAccess } from "@/lib/access";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { subscriptionQuote } from "@/lib/saas-pricing";
import { recurringBillingReady } from "@/lib/saas-launch-config";
import { createXenditSubscriptionSession, newSubscriptionReference } from "@/lib/xendit-subscriptions";
import { canonicalAppOrigin, enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Subscription checkout");
  if (demoDenied) return demoDenied;
  if (!recurringBillingReady()) {
    return Response.json({ error: "Automated monthly billing is not enabled. No charge has been created." }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId < 1) {
    return Response.json({ error: "Select a valid company." }, { status: 400 });
  }
  const forbidden = await assertOrganizationRole(user.id, organizationId, BILLING_ADMIN_ROLES);
  if (forbidden) return forbidden;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide billing access required." }, { status: 403 });
  // Newly verified owners may have no authenticator yet. Existing users with MFA
  // enabled must still prove possession of that factor for payment actions.
  if (user.totpEnabled) {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
  }
  const limited = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "saas-checkout", resourceId: organizationId, limit: 4, windowMs: 30 * 60_000,
  });
  if (limited) return limited;
  let origin: string;
  try { origin = canonicalAppOrigin(request); }
  catch { return Response.json({ error: "Billing origin is not configured." }, { status: 503 }); }

  const existing = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  const sub = existing[0];
  if (!sub || sub.status !== "pending_payment") {
    return Response.json({ error: "A pending subscription is required; an existing paid plan cannot create another recurring charge." }, { status: 409 });
  }
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) return Response.json({ error: "Company not found." }, { status: 404 });
  const catalog = await getPublicPricingPlans();
  const entry = catalog.find((row) => row.name === sub.plan && row.active);
  if (!entry) return Response.json({ error: "This plan is not currently available for checkout." }, { status: 422 });
  const quote = subscriptionQuote(entry, sub.seatLimit);
  if (quote.amountCents !== sub.amountCents || sub.billingCycle !== "monthly" || sub.currency !== "PHP") {
    return Response.json({ error: "The plan price changed. Contact support before completing checkout." }, { status: 409 });
  }

  const [last] = await db.select().from(saasBillingCheckouts)
    .where(and(eq(saasBillingCheckouts.organizationId, organizationId),
      inArray(saasBillingCheckouts.status, ["creating", "awaiting_payment", "review_required"])))
    .orderBy(desc(saasBillingCheckouts.id)).limit(1);
  if (last?.status === "awaiting_payment" && last.checkoutUrl && (!last.expiresAt || last.expiresAt > new Date())) {
    return Response.json({ ok: true, checkoutUrl: last.checkoutUrl, existing: true });
  }
  if (last) return Response.json({
    error: "A subscription checkout is already pending or needs review. We will not create a second automatic charge.",
    code: "EXISTING_CHECKOUT",
  }, { status: 409 });

  const referenceId = newSubscriptionReference(organizationId);
  let attempt: typeof saasBillingCheckouts.$inferSelect;
  try {
    [attempt] = await db.insert(saasBillingCheckouts).values({
      organizationId, subscriptionId: sub.id, referenceId,
      plan: quote.plan, seats: quote.seats, amountCents: quote.amountCents,
      currency: "PHP", status: "creating",
    }).returning();
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return Response.json({ error: "Another checkout is already in progress." }, { status: 409 });
    }
    throw error;
  }

  try {
    const session = await createXenditSubscriptionSession({
      referenceId, organizationId, userId: user.id, name: user.name, email: user.email,
      plan: quote.plan, seats: quote.seats, amountCents: quote.amountCents,
      successUrl: origin + "/billing/setup?return=success",
      cancelUrl: origin + "/billing/setup?return=cancel",
    });
    await db.update(saasBillingCheckouts).set({
      providerSessionId: session.payment_session_id,
      providerPlanId: session.recurring_plan_id,
      checkoutUrl: session.payment_link_url,
      expiresAt: session.expires_at ? new Date(session.expires_at) : null,
      status: "awaiting_payment",
    }).where(eq(saasBillingCheckouts.id, attempt.id));
    await db.update(subscriptions).set({
      provider: "xendit",
      providerRef: session.recurring_plan_id,
    }).where(eq(subscriptions.id, sub.id));

    await recordAuditEvent({
      organizationId, actor: user.name, action: "Recurring hosted subscription checkout created",
      resource: referenceId,
      metadata: { plan: quote.plan, seats: quote.seats, amountCents: quote.amountCents, provider: "xendit" },
    });
    return Response.json({
      ok: true,
      checkoutUrl: session.payment_link_url,
      amountCents: quote.amountCents,
      currency: "PHP",
      message: "Complete the hosted recurring authorization. Your subscription activates only after a verified successful payment event.",
    }, { status: 201 });
  } catch (error) {
    // Network timeouts may mean Xendit created the plan. Never retry blindly:
    // operations must reconcile the referenceId in the provider dashboard.
    await db.update(saasBillingCheckouts)
      .set({ status: "review_required" }).where(eq(saasBillingCheckouts.id, attempt.id));
    return Response.json({
      error: "The payment provider did not return a completed checkout. No second charge will be attempted automatically. Contact support with this reference.",
      referenceId,
      code: "BILLING_RECONCILIATION_REQUIRED",
    }, { status: 503 });
  }
}
