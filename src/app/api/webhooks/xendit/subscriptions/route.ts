import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, subscriptions } from "@/db/schema";
import { saasBillingCheckouts, saasBillingEvents, saasBillingState } from "@/lib/saas-billing-schema";
import { nextBillingMonth } from "@/lib/saas-pricing";
import { checkoutHostnameAllowed } from "@/lib/saas-launch-config";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const EVENTS = new Set([
  "recurring.plan.activated", "recurring.plan.inactivated",
  "recurring.cycle.created", "recurring.cycle.retrying",
  "recurring.cycle.succeeded", "recurring.cycle.failed",
  "recurring.cycle.force_attempt_failed",
]);
type WebhookData = {
  id?: unknown; plan_id?: unknown; recurring_plan_id?: unknown;
  reference_id?: unknown; amount?: unknown; currency?: unknown;
  scheduled_timestamp?: unknown; status?: unknown;
  payment_session_id?: unknown; attempt_details?: unknown;
};
type WebhookPayload = {
  event?: unknown; business_id?: unknown; data?: WebhookData;
};

function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }

export async function POST(request: Request) {
  const callbackToken = process.env.XENDIT_CALLBACK_TOKEN?.trim();
  const expectedBusinessId = process.env.XENDIT_BUSINESS_ID?.trim();
  if (!callbackToken || !expectedBusinessId || process.env.XENDIT_BILLING_ENABLED !== "true") {
    return Response.json({ error: "Subscription webhooks are not enabled." }, { status: 503 });
  }
  const incomingToken = request.headers.get("x-callback-token");
  if (!constantTimeSecretEqual(incomingToken, callbackToken)) {
    return Response.json({ error: "Webhook authentication failed." }, { status: 401 });
  }
  const raw = await request.text();
  if (raw.length > 100_000) return Response.json({ error: "Payload too large." }, { status: 413 });
  let payload: WebhookPayload;
  try { payload = JSON.parse(raw || "{}") as WebhookPayload; }
  catch { return Response.json({ error: "Invalid webhook JSON." }, { status: 400 }); }
  if (payload.business_id !== expectedBusinessId) {
    return Response.json({ error: "Incorrect billing merchant." }, { status: 403 });
  }
  const event = stringValue(payload.event);
  if (!EVENTS.has(event)) return Response.json({ received: true, ignored: true });
  const data = payload.data || {};
  const referenceId = stringValue(data.reference_id);
  const planId = stringValue(data.plan_id || data.recurring_plan_id || (event.startsWith("recurring.plan.") ? data.id : null));
  if (!referenceId || !planId) {
    return Response.json({ error: "Subscription identity is missing." }, { status: 422 });
  }

  const [attempt] = await db.select().from(saasBillingCheckouts)
    .where(and(eq(saasBillingCheckouts.referenceId, referenceId), eq(saasBillingCheckouts.providerPlanId, planId))).limit(1);
  if (!attempt) {
    // The provider can send a webhook before the checkout request stores its
    // plan ID; return non-2xx so Xendit retries after it is persisted.
    return Response.json({ error: "Subscription is not reconciled yet." }, { status: 503 });
  }
  if (event.startsWith("recurring.cycle.") && (data.currency !== "PHP"
    || typeof data.amount !== "number"
    || Math.round(data.amount * 100) !== attempt.amountCents)) {
    return Response.json({ error: "Subscription payment does not match the authorized amount or currency." }, { status: 422 });
  }
  const cycleId = stringValue(data.id);
  const keySource = event.startsWith("recurring.cycle.")
    ? event + "|" + planId + "|" + cycleId
    : event + "|" + planId;
  if (event.startsWith("recurring.cycle.") && !cycleId) return Response.json({ error: "Cycle ID missing." }, { status: 422 });
  const eventKey = createHash("sha256").update(keySource).digest("hex");
  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(saasBillingEvents).values({
      providerEventKey: eventKey,
      organizationId: attempt.organizationId,
      providerPlanId: planId,
      eventType: event,
    }).onConflictDoNothing().returning({ id: saasBillingEvents.id });
    if (!inserted) return { handled: false, duplicate: true } as const;
    const [sub] = await tx.select().from(subscriptions)
      .where(eq(subscriptions.id, attempt.subscriptionId)).for("update").limit(1);
    if (!sub || sub.organizationId !== attempt.organizationId) {
      throw new Error("Subscription tenant mapping mismatch.");
    }
    const [state] = await tx.select().from(saasBillingState)
      .where(eq(saasBillingState.organizationId, attempt.organizationId)).limit(1);
    if (state?.providerPlanId && state.providerPlanId !== planId) {
      // Old subscription callbacks must not reactivate a newer plan.
      return { handled: false, stale: true } as const;
    }

    if (event === "recurring.cycle.succeeded") {
      if (data.status !== "SUCCEEDED") {
        throw new Error("A payment success webhook must contain a succeeded cycle.");
      }
      const now = new Date();
      const periodStart = state?.paidThrough && state.paidThrough > now ? state.paidThrough : now;
      const paidThrough = nextBillingMonth(periodStart);
      await tx.insert(saasBillingState).values({
        organizationId: attempt.organizationId,
        subscriptionId: sub.id,
        providerPlanId: planId,
        lastPaidCycleId: cycleId,
        paidThrough,
        recoveryUrl: null,
        cancelAtPeriodEnd: state?.cancelAtPeriodEnd ?? false,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: saasBillingState.organizationId,
        set: { providerPlanId: planId, lastPaidCycleId: cycleId, paidThrough, recoveryUrl: null, updatedAt: now },
      });
      await tx.update(subscriptions).set({
        status: state?.cancelAtPeriodEnd ? "cancel_at_period_end" : "active",
        plan: attempt.plan,
        seatLimit: attempt.seats,
        amountCents: attempt.amountCents,
        provider: "xendit",
        providerRef: planId,
        periodStart,
        periodEnd: paidThrough,
        cancelledAt: state?.cancelAtPeriodEnd ? state.cancelledAt : null,
      }).where(eq(subscriptions.id, sub.id));
      await tx.update(saasBillingCheckouts).set({ status: "active" }).where(eq(saasBillingCheckouts.id, attempt.id));
      const invoiceNo = "XS-" + createHash("sha256").update(planId + ":" + cycleId).digest("hex").slice(0, 22).toUpperCase();
      await tx.insert(invoices).values({
        organizationId: attempt.organizationId,
        subscriptionId: sub.id,
        number: invoiceNo,
        amountCents: attempt.amountCents,
        currency: "PHP",
        status: "paid",
        paidAt: now,
      });
      return { handled: true, status: "paid" } as const;
    }
    if (event === "recurring.cycle.failed" || event === "recurring.cycle.retrying") {
      const recoveryLink = Array.isArray(data.attempt_details)
        ? data.attempt_details.map((attempt) => {
          if (!attempt || typeof attempt !== "object") return "";
          const candidate = (attempt as { payment_session?: { payment_link_url?: unknown } }).payment_session?.payment_link_url;
          return typeof candidate === "string" ? candidate : "";
        }).find((url) => url.length <= 2500 && checkoutHostnameAllowed(url)) ?? null
        : null;
      if (recoveryLink && state) {
        await tx.update(saasBillingState).set({ recoveryUrl: recoveryLink, updatedAt: new Date() })
          .where(eq(saasBillingState.organizationId, attempt.organizationId));
      }
      if (sub.status === "active" && !state?.cancelAtPeriodEnd) {
        await tx.update(subscriptions).set({ status: "past_due" }).where(eq(subscriptions.id, sub.id));
      }
      return { handled: true, status: "past_due" } as const;
    }
    if (event === "recurring.plan.inactivated") {
      // Deactivation alone is NOT a refund and never destroys payroll history.
      await tx.update(subscriptions).set({
        status: state?.cancelAtPeriodEnd ? "cancel_at_period_end" : "cancelled",
      }).where(eq(subscriptions.id, sub.id));
      return { handled: true, status: "inactive" } as const;
    }
    return { handled: true, status: "acknowledged" } as const;
  });

  if (result.handled && ["paid", "past_due", "inactive"].includes(result.status)) {
    await recordAuditEvent({
      organizationId: attempt.organizationId,
      actor: "Xendit verified webhook",
      action: event,
      resource: "Subscription " + attempt.subscriptionId,
      metadata: { eventKey, providerPlanId: planId, cycleId: cycleId || undefined, outcome: result.status },
    });
  }
  return Response.json({ received: true, ...result });
}
