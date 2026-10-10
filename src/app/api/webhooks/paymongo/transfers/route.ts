import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, payrollRuns, providerEvents } from "@/db/schema";
import {
  normalizePaymongoTransferWebhook,
  verifyPaymongoWebhookSignature,
} from "@/lib/paymongo-transfer-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuditRow = typeof auditEvents.$inferSelect;

function metadata(event: AuditRow) {
  return event.metadata && typeof event.metadata === "object"
    ? event.metadata as Record<string, unknown>
    : {};
}

function storedTransferForRun(events: AuditRow[], input: {
  runId: number;
  transferId: string;
  referenceNumber: string;
}) {
  const sourceActions = new Set([
    "Payroll payout submitted via PayMongo",
    "Payroll payout completed via PayMongo",
    "Payroll payout retry submitted via PayMongo",
  ]);

  for (const event of events) {
    if (!sourceActions.has(event.action)) continue;
    const meta = metadata(event);
    if (Number(meta.runId) !== input.runId || !Array.isArray(meta.transfers)) continue;
    for (const raw of meta.transfers) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      if (row.id !== input.transferId || row.referenceNumber !== input.referenceNumber) continue;
      return {
        batchId: typeof meta.batchId === "string" ? meta.batchId : null,
        amountCents: Number(row.amountCents),
      };
    }
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "PayMongo webhook verification is not configured." },
      { status: 503 },
    );
  }

  const payload = await request.text();
  const valid = verifyPaymongoWebhookSignature({
    payload,
    signatureHeader: request.headers.get("paymongo-signature"),
    secret,
  });
  if (!valid) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const event = normalizePaymongoTransferWebhook(parsed);
  if (!event) {
    return Response.json({ ok: true, ignored: true });
  }

  if (process.env.NODE_ENV === "production" && !event.liveMode) {
    return Response.json({ ok: true, ignored: true, reason: "test-mode-event" });
  }

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, event.runId)).limit(1);
  if (!run) {
    return Response.json({ ok: true, ignored: true, reason: "unknown-payroll-run" });
  }

  if (!event.eventId || event.eventId.length > 180) {
    return Response.json({ error: "Invalid provider event ID." }, { status: 400 });
  }

  // Only fetch payout submission audit receipts for the matching run. These
  // records are interim evidence until A-2 moves transfers into their own
  // unique run/employee state ledger.
  const events = await db.select().from(auditEvents).where(and(
    eq(auditEvents.organizationId, run.organizationId),
    inArray(auditEvents.action, [
      "Payroll payout submitted via PayMongo",
      "Payroll payout completed via PayMongo",
      "Payroll payout retry submitted via PayMongo",
    ]),
    sql`${auditEvents.metadata} ->> 'runId' = ${String(run.id)}`,
  )).orderBy(desc(auditEvents.id));

  const stored = storedTransferForRun(events, {
    runId: run.id,
    transferId: event.transferId,
    referenceNumber: event.referenceNumber,
  });
  if (!stored || !Number.isFinite(stored.amountCents) || stored.amountCents !== event.amountCents) {
    return Response.json({ ok: true, ignored: true, reason: "unmatched-payroll-transfer" });
  }

  // Insert provider event + audit receipt atomically. A unique(provider,
  // eventId) index serializes simultaneous deliveries across workers.
  const recorded = await db.transaction(async (tx) => {
    const [accepted] = await tx.insert(providerEvents).values({
      provider: "paymongo",
      eventId: event.eventId,
      organizationId: run.organizationId,
      payrollRunId: run.id,
      eventType: event.eventType,
    }).onConflictDoNothing({
      target: [providerEvents.provider, providerEvents.eventId],
    }).returning({ id: providerEvents.id });
    if (!accepted) return false;

    await tx.insert(auditEvents).values({
      organizationId: run.organizationId,
      actor: "PayMongo webhook",
      action: "PayMongo transfer webhook received",
      resource: run.periodLabel,
      metadata: {
        runId: run.id,
        eventId: event.eventId,
        eventType: event.eventType,
        liveMode: event.liveMode,
        batchId: stored.batchId,
        transferId: event.transferId,
        batchTransactionId: event.batchTransactionId,
        referenceNumber: event.referenceNumber,
        employeeNo: event.employeeNo,
        status: event.status,
        amountCents: event.amountCents,
        provider: event.provider,
        providerReferenceNumber: event.providerReferenceNumber,
        providerError: event.providerError,
        providerErrorCode: event.providerErrorCode,
        occurredAt: event.occurredAt,
        settlementVerified: event.status === "succeeded",
      },
    });
    return true;
  });

  return Response.json(recorded
    ? { ok: true, recorded: true }
    : { ok: true, duplicate: true });
}
