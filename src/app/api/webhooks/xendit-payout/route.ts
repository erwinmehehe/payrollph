import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import {
  verifyXenditPayoutWebhookToken, normalizeXenditPayoutWebhook,
} from "@/lib/xendit-payroll-payouts";
import { recordXenditPayoutObservation } from "@/lib/xendit-payout-ledger";

export const dynamic = "force-dynamic";

/**
 * Provider event inbox: authenticated, tenant/business-bound, auditable and
 * unique-deduped in provider_events. No payroll/payout is created here.
 */
export async function POST(request: Request) {
  const callbackToken = process.env.XENDIT_PAYOUT_CALLBACK_TOKEN;
  if (!verifyXenditPayoutWebhookToken(
    request.headers.get("x-callback-token"), callbackToken,
  )) return Response.json({ error: "Invalid callback token." }, { status: 401 });
  const allowedOrg = Number(process.env.XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID);
  const allowedLegal = Number(process.env.XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID);
  const businessId = process.env.XENDIT_PAYOUT_BUSINESS_ID?.trim();
  if (!businessId || !Number.isSafeInteger(allowedOrg) || allowedOrg <= 0
    || !Number.isSafeInteger(allowedLegal) || allowedLegal <= 0) {
    return Response.json({ error: "Xendit payout webhook business scope is not configured." },
      { status: 503 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 128_000) {
    return Response.json({ error: "Xendit webhook size exceeded." }, { status: 413 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const event = normalizeXenditPayoutWebhook(body, businessId);
  if (!event) return Response.json({ error: "Unrecognized Xendit V3 payout event." },
    { status: 422 });
  const created = body && typeof body === "object"
    ? (body as Record<string, unknown>).created : null;
  if (typeof created !== "string" || !Number.isFinite(Date.parse(created))) {
    return Response.json({ error: "Event timestamp required." }, { status: 422 });
  }
  const parsed = /^PAY-([1-9]\d*)-([A-Za-z0-9_-]+)$/.exec(event.referenceNumber);
  const runId = parsed ? Number(parsed[1]) : NaN;
  if (!Number.isSafeInteger(runId) || runId <= 0) return Response.json({
    error: "Unrecognized payroll payout reference.",
  }, { status: 422 });

  const [run] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.id, runId),
    eq(payrollRuns.organizationId, allowedOrg),
    eq(payrollRuns.legalEntityId, allowedLegal),
  )).limit(1);
  if (!run || run.status !== "Released") {
    return Response.json({ error: "No matching released employer payroll." }, { status: 404 });
  }
  const suppliedId = request.headers.get("webhook-id");
  const eventId = suppliedId && /^[A-Za-z0-9_-]{8,160}$/.test(suppliedId)
    ? suppliedId
    : createHash("sha256")
      .update(JSON.stringify([event.event, event.payoutId, event.referenceNumber, event.status, created]))
      .digest("hex");
  try {
    const result = await recordXenditPayoutObservation({
      organizationId: allowedOrg, payrollRunId: run.id,
      referenceNumber: event.referenceNumber, amountCents: event.amountCents,
      providerPayoutId: event.payoutId, providerBusinessId: businessId,
      expectedBusinessId: businessId, providerStatus: event.status,
      eventId, eventType: event.event,
    });
    return Response.json({ accepted: true, duplicate: !result.recorded }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Do not acknowledge a mismatched or non-durable settlement record.
    // Xendit can retry. This response deliberately contains no sensitive data.
    return Response.json({ error: "Settlement observation rejected; manual review required." },
      { status: 409 });
  }
}
