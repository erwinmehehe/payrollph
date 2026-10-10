import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { saasBillingState } from "@/lib/saas-billing-schema";
import { BILLING_ADMIN_ROLES, assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { verifyPassword } from "@/lib/crypto";
import { recurringBillingReady } from "@/lib/saas-launch-config";
import { deactivateXenditSubscription } from "@/lib/xendit-subscriptions";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Subscription cancellation");
  if (demoDenied) return demoDenied;
  if (!recurringBillingReady()) {
    return Response.json({ error: "Provider cancellation is unavailable. Contact billing support to stop renewal." }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId < 1) {
    return Response.json({ error: "Select a valid company." }, { status: 400 });
  }
  const roleDenied = await assertOrganizationRole(user.id, organizationId, BILLING_ADMIN_ROLES);
  if (roleDenied) return roleDenied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide billing access required." }, { status: 403 });
  const limited = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "saas-subscription-cancel", resourceId: organizationId,
    limit: 5, windowMs: 60 * 60_000,
  });
  if (limited) return limited;
  if (user.totpEnabled) {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const [account] = await db.select({ passwordHash: users.passwordHash }).from(users)
    .where(eq(users.id, user.id)).limit(1);
  if (!account || !currentPassword || !verifyPassword(currentPassword, account.passwordHash)) {
    return Response.json({ error: "Confirm your current password to stop automatic renewal." }, { status: 403 });
  }
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
  const [state] = await db.select().from(saasBillingState).where(eq(saasBillingState.organizationId, organizationId)).limit(1);
  if (!sub || sub.provider !== "xendit" || !sub.providerRef || !state) {
    return Response.json({ error: "There is no automated recurring subscription to cancel." }, { status: 409 });
  }
  if (state.cancelAtPeriodEnd) {
    return Response.json({ ok: true, alreadyCancelled: true, accessUntil: state.paidThrough });
  }

  // The provider cancellation takes effect immediately for future charges.
  // The app continues read/write access until the end of the last paid term.
  try {
    await deactivateXenditSubscription(sub.providerRef);
  } catch {
    return Response.json({
      error: "The payment provider has not confirmed cancellation. Please contact billing support; automatic renewal may still be active.",
      code: "PROVIDER_CANCELLATION_NOT_CONFIRMED",
    }, { status: 502 });
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(saasBillingState).set({ cancelAtPeriodEnd: true, cancelledAt: now, updatedAt: now })
      .where(eq(saasBillingState.organizationId, organizationId));
    await tx.update(subscriptions).set({
      status: "cancel_at_period_end",
      cancelledAt: now,
    }).where(eq(subscriptions.id, sub.id));
  });
  await recordAuditEvent({
    organizationId, actor: user.name,
    action: "Subscription automatic renewal cancelled",
    resource: sub.plan,
    metadata: { paidThrough: state.paidThrough?.toISOString() ?? null, provider: "xendit" },
  });
  return Response.json({
    ok: true,
    automaticRenewal: false,
    accessUntil: state.paidThrough,
    message: "Your automatic monthly charges have been stopped. Access lasts until the paid-through date. No employee or payroll records have been deleted.",
  });
}
