import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, subscriptions } from "@/db/schema";
import { saasBillingCheckouts, saasBillingState } from "@/lib/saas-billing-schema";
import { BILLING_ADMIN_ROLES, assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getEntitlements } from "@/lib/billing";
import { paidAccessAllowed } from "@/lib/saas-pricing";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId < 1) {
    return Response.json({ error: "Select a company to manage billing." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(user.id, organizationId, BILLING_ADMIN_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide billing access required." }, { status: 403 });
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  const [state] = await db.select().from(saasBillingState).where(eq(saasBillingState.organizationId, organizationId)).limit(1);
  const [attempt] = await db.select({
    status: saasBillingCheckouts.status,
    checkoutUrl: saasBillingCheckouts.checkoutUrl,
    expiresAt: saasBillingCheckouts.expiresAt,
  }).from(saasBillingCheckouts).where(eq(saasBillingCheckouts.organizationId, organizationId))
    .orderBy(desc(saasBillingCheckouts.id)).limit(1);
  const history = await db.select({
    number: invoices.number,
    amountCents: invoices.amountCents,
    currency: invoices.currency,
    status: invoices.status,
    paidAt: invoices.paidAt,
    createdAt: invoices.createdAt,
  }).from(invoices).where(eq(invoices.organizationId, organizationId)).orderBy(desc(invoices.createdAt)).limit(20);
  const entitlement = await getEntitlements(organizationId);
  const accessUntil = state?.paidThrough ?? sub?.periodEnd ?? null;
  return Response.json({
    subscription: sub ? {
      plan: sub.plan,
      seats: sub.seatLimit,
      status: sub.status,
      amountCents: sub.amountCents,
      currency: sub.currency,
      billingCycle: sub.billingCycle,
      provider: sub.provider,
      paidThrough: accessUntil,
      cancelAtPeriodEnd: state?.cancelAtPeriodEnd ?? false,
      recoveryUrl: state?.recoveryUrl ?? null,
      activeAccess: sub.provider === "xendit" && accessUntil
        ? paidAccessAllowed({ status: sub.status, paidThrough: accessUntil })
        : entitlement.active,
    } : null,
    latestCheckout: attempt && attempt.status === "awaiting_payment"
      ? { status: attempt.status, checkoutUrl: attempt.checkoutUrl, expiresAt: attempt.expiresAt } : null,
    invoices: history,
    message: "Billing is based on verified provider events, never on a return-link redirect.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
