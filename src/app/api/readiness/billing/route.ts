import { and, count, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { saasBillingCheckouts, saasBillingEvents, saasBillingState } from "@/lib/saas-billing-schema";
import { constantTimeSecretEqual } from "@/lib/security-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Internal subscription operations probe. No raw identifiers, account emails,
 * government IDs, payment tokens or checkout links leave this endpoint.
 * Production monitoring must send HEALTH_TOKEN as x-health-token.
 */
export async function GET(request: Request) {
  const token = process.env.HEALTH_TOKEN?.trim();
  const supplied = request.headers.get("x-health-token");
  if (!token || !constantTimeSecretEqual(supplied, token)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60_000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
  try {
    const [pastDue, pending, review, staleCreating, expiredPaid, completed24h] = await Promise.all([
      db.select({ total: count() }).from(subscriptions).where(and(eq(subscriptions.provider, "xendit"), eq(subscriptions.status, "past_due"))),
      db.select({ total: count() }).from(subscriptions).where(eq(subscriptions.status, "pending_payment")),
      db.select({ total: count() }).from(saasBillingCheckouts).where(eq(saasBillingCheckouts.status, "review_required")),
      db.select({ total: count() }).from(saasBillingCheckouts).where(and(
        eq(saasBillingCheckouts.status, "creating"), lt(saasBillingCheckouts.createdAt, thirtyMinutesAgo),
      )),
      db.select({ total: count() }).from(saasBillingState).where(and(
        lt(saasBillingState.paidThrough, now), eq(saasBillingState.cancelAtPeriodEnd, false),
      )),
      db.select({ total: count() }).from(saasBillingEvents).where(and(
        eq(saasBillingEvents.eventType, "recurring.cycle.succeeded"),
        sql`${saasBillingEvents.createdAt} >= ${yesterday}`,
      )),
    ]);
    const metrics = {
      pastDueSubscriptions: pastDue[0]?.total ?? 0,
      pendingPaymentSubscriptions: pending[0]?.total ?? 0,
      reconciliationRequired: review[0]?.total ?? 0,
      staleCreatingCheckouts: staleCreating[0]?.total ?? 0,
      expiredPaidTerms: expiredPaid[0]?.total ?? 0,
      confirmedCycles24h: completed24h[0]?.total ?? 0,
    };
    const degraded = metrics.reconciliationRequired > 0 || metrics.staleCreatingCheckouts > 0;
    return Response.json({
      ok: !degraded,
      checkedAt: now.toISOString(),
      metrics,
      attention: degraded ? "Billing operator reconciliation is required." : null,
    }, { status: degraded ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Billing telemetry database unavailable." }, { status: 503 });
  }
}
