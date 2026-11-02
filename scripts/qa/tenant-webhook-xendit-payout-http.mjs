/**
 * Xendit payout webhook, synthetic-only PostgreSQL 16 + production-mode localhost HTTP.
 * The route pins one employer from the environment (first organization and legal
 * entity of a fresh database). Proof: own observation recorded once; replay and
 * concurrent delivery deduplicated; a real higher-ID victim run, a second attacker
 * run, an unknown run and cross-bound references are refused with identical bodies
 * and unchanged SQL; forged organization selectors are ignored.
 * This is proposed evidence only: ZERO manifest method credits.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { requireDisposableXenditPayoutWebhook } from "./tenant-webhook-xendit-payout-contract.mjs";

const URL_PATH = "/api/webhooks/xendit-payout";

export async function proveXenditPayoutWebhook() {
  // Absolutely no application / database module imports before this refusal.
  requireDisposableXenditPayoutWebhook();
  const [database, s, drizzle, helpers, ledger] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("../../src/lib/payout-ledger.ts"),
  ]);
  const { db, pool } = database;
  const { eq, asc } = drizzle;
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const token = process.env.XENDIT_PAYOUT_CALLBACK_TOKEN;
  const businessId = process.env.XENDIT_PAYOUT_BUSINESS_ID;
  try {
    const serverVersion = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(serverVersion.rows[0]?.server_version_num) / 10000), 16,
      "XENDIT_PAYOUT_WEBHOOK_REFUSED: actual disposable PostgreSQL 16 required");
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "Fixture refuses preexisting employer data");

    // Seeding order fixes the IDs: ATTA is organization 1 / legal entity 1 (the pinned
    // employer), ATTB is a second attacker, VICTIM has genuinely higher run, batch and
    // transfer IDs than both.
    const a = await helpers.seedEmployer("ATTA", nonce, helpers.standaloneMakeSession);
    const b = await helpers.seedEmployer("ATTB", nonce, helpers.standaloneMakeSession);
    const victim = await helpers.seedEmployer("VICTIM", nonce, helpers.standaloneMakeSession);
    assert.equal(a.org.id, 1, "the pinned employer must be the first organization of a fresh database");
    assert.equal(a.entity.id, 1, "the pinned legal entity must be the first of a fresh database");
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);

    async function seedPayout(employer) {
      const [run] = await db.insert(s.payrollRuns).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        periodLabel: "Synthetic no-money payout " + employer.marker, periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-20", status: "Released", employeeCount: 1, grossPay: "100.00", netPay: "100.00",
      }).returning();
      const [entry] = await db.insert(s.payrollEntries).values({
        payrollRunId: run.id, employeeId: employer.worker.id, grossPay: "100.00", deductions: "0.00", netPay: "100.00",
      }).returning();
      const referenceNumber = "PAY-" + run.id + "-" + employer.worker.employeeNo;
      const prepared = await ledger.prepareInitialPayoutBatch({
        organizationId: employer.org.id, payrollRunId: run.id, provider: "xendit",
        intents: [{ employeeId: employer.worker.id, payrollEntryId: entry.id, referenceNumber, amountCents: 10000 }],
      });
      // Fixture state only: an already-claimed payout, as the claim step would leave it. No provider call.
      await db.update(s.payoutTransfers).set({ status: "submitting" }).where(eq(s.payoutTransfers.organizationId, employer.org.id));
      await db.update(s.payoutBatchTransfers).set({ status: "submitting" }).where(eq(s.payoutBatchTransfers.organizationId, employer.org.id));
      await db.update(s.payoutBatches).set({ status: "submitting" }).where(eq(s.payoutBatches.organizationId, employer.org.id));
      const [transfer] = await db.select().from(s.payoutTransfers).where(eq(s.payoutTransfers.organizationId, employer.org.id));
      return { run, entry, referenceNumber, batchId: prepared.batchId, transferId: transfer.id };
    }
    a.payout = await seedPayout(a);
    b.payout = await seedPayout(b);
    victim.payout = await seedPayout(victim);
    for (const key of ["batchId", "transferId"]) assert.ok(victim.payout[key] > a.payout[key] && victim.payout[key] > b.payout[key], "victim " + key + " must be higher");
    assert.ok(victim.payout.run.id > a.payout.run.id && victim.payout.run.id > b.payout.run.id);

    const snapshot = async employer => {
      const id = employer.org.id;
      const rows = async (table, column = "organizationId") => db.select().from(table).where(eq(table[column], id)).orderBy(asc(table.id));
      return JSON.parse(JSON.stringify({
        batches: await rows(s.payoutBatches), links: await rows(s.payoutBatchTransfers), transfers: await rows(s.payoutTransfers),
        providerEvents: await rows(s.providerEvents), audit: await rows(s.auditEvents), runs: await rows(s.payrollRuns),
        entries: await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, employer.payout.run.id)).orderBy(asc(s.payrollEntries.id)),
      }));
    };
    const all = [a, b, victim];
    const snapshots = async () => Object.fromEntries(await Promise.all(all.map(async employer => [employer.label, await snapshot(employer)])));
    const unchangedExcept = async (before, ...changed) => {
      const after = await snapshots();
      for (const employer of all) if (!changed.includes(employer.label)) assert.deepEqual(after[employer.label], before[employer.label], employer.label + " SQL must not change");
      return after;
    };
    const payoutId = () => "po-" + randomBytes(12).toString("hex");
    const eventBody = (employer, { event = "v3_payout.pending_compliance", status = "PENDING_COMPLIANCE_ASSESSMENT", reference, extra = {}, dataExtra = {}, business = businessId } = {}) => ({
      created: "2026-10-22T12:00:00.000Z", event, business_id: business,
      data: { payout_id: employer.payoutId, reference_id: reference ?? employer.payout.referenceNumber, status, source_amount: 10000,
        source_currency: "PHP", destination_currency: "PHP", business_id: business, ...dataExtra }, ...extra,
    });
    // A provider callback carries no cookie and no Origin header.
    async function send(body, { eventId = "evt-" + randomBytes(12).toString("hex"), callbackToken = token } = {}) {
      const headers = { "content-type": "application/json", "webhook-id": eventId };
      if (callbackToken !== null) headers["x-callback-token"] = callbackToken;
      const response = await fetch(new URL(URL_PATH, process.env.SECURITY_SMOKE_URL), { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", cache: "no-store" });
      const text = await response.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      return { status: response.status, text, json, eventId };
    }
    for (const employer of all) employer.payoutId = payoutId();

    // Authentication negatives never count as tenant credit; they must write nothing.
    let before = await snapshots();
    assert.equal((await send(eventBody(a), { callbackToken: null })).status, 401);
    assert.equal((await send(eventBody(a), { callbackToken: token + "x" })).status, 401);
    assert.equal((await send(eventBody(a, { business: businessId + "x" }))).status, 422);
    await unchangedExcept(before);

    // Own object: recorded once for the pinned employer, nothing for anyone else.
    before = await snapshots();
    const ownEvent = await send(eventBody(a));
    assert.equal(ownEvent.status, 200, ownEvent.text);
    assert.deepEqual(ownEvent.json, { accepted: true, duplicate: false });
    let after = await unchangedExcept(before, "ATTA");
    assert.equal(after.ATTA.providerEvents.length, before.ATTA.providerEvents.length + 1);
    const recorded = after.ATTA.providerEvents.at(-1);
    assert.deepEqual([recorded.provider, recorded.eventId, recorded.organizationId, recorded.payrollRunId],
      ["xendit", ownEvent.eventId, a.org.id, a.payout.run.id]);
    assert.equal(after.ATTA.audit.length, before.ATTA.audit.length + 1);
    assert.equal(after.ATTA.audit.at(-1).action, "Xendit payout transfer observed");
    assert.equal(after.ATTA.transfers[0].status, "submitted");
    assert.equal(after.ATTA.links[0].providerTransferId, a.payoutId);
    assert.equal(after.ATTA.links[0].status, "submitted");

    // Replay of the same delivery: acknowledged as a duplicate, no further write.
    before = await snapshots();
    const replayEvent = await send(eventBody(a), { eventId: ownEvent.eventId });
    assert.deepEqual([replayEvent.status, replayEvent.json], [200, { accepted: true, duplicate: true }]);
    await unchangedExcept(before);

    // Forged selectors: organization, entity and run fields that name the victim are ignored.
    before = await snapshots();
    const forgedEvent = await send(eventBody(a, {
      extra: { organizationId: victim.org.id, legalEntityId: victim.entity.id, runId: victim.payout.run.id },
      dataExtra: { organizationId: victim.org.id, payrollRunId: victim.payout.run.id, employeeId: victim.worker.id },
    }));
    assert.deepEqual([forgedEvent.status, forgedEvent.json], [200, { accepted: true, duplicate: false }]);
    after = await unchangedExcept(before, "ATTA");
    assert.equal(after.ATTA.providerEvents.length, before.ATTA.providerEvents.length + 1);
    assert.equal(after.ATTA.providerEvents.at(-1).organizationId, a.org.id);

    // Two concurrent deliveries of one settlement event produce exactly one write.
    before = await snapshots();
    const settledId = "evt-" + randomBytes(12).toString("hex");
    const settled = eventBody(a, { event: "v3_payout.succeeded", status: "SUCCEEDED" });
    const raced = await Promise.all([send(settled, { eventId: settledId }), send(settled, { eventId: settledId })]);
    assert.deepEqual(raced.map(r => r.status), [200, 200]);
    assert.deepEqual(raced.map(r => r.json.duplicate).sort(), [false, true]);
    after = await unchangedExcept(before, "ATTA");
    assert.equal(after.ATTA.providerEvents.length, before.ATTA.providerEvents.length + 1);
    assert.equal(after.ATTA.audit.length, before.ATTA.audit.length + 1);
    assert.equal(after.ATTA.transfers[0].status, "succeeded");

    // Foreign: a valid callback token and signed-shape event naming a real victim run, a second
    // attacker's run, and an unknown run all get the same refusal, and no SQL changes anywhere.
    before = await snapshots();
    const foreignVictim = await send(eventBody(victim));
    const foreignSecondAttacker = await send(eventBody(b));
    const unknownRun = Number(victim.payout.run.id) + 1_000_000;
    const unknown = await send(eventBody(victim, { reference: "PAY-" + unknownRun + "-" + victim.worker.employeeNo }));
    for (const response of [foreignVictim, foreignSecondAttacker, unknown]) assert.equal(response.status, 404, response.text);
    assert.deepEqual(foreignVictim.json, { error: "No matching released employer payroll." });
    assert.equal(foreignVictim.text, unknown.text, "a real foreign run must not be distinguishable from a nonexistent run");
    assert.equal(foreignSecondAttacker.text, unknown.text);
    for (const forbidden of [victim.marker, String(victim.payout.run.id), victim.payoutId]) assert.ok(!foreignVictim.text.includes(forbidden), "denial must not echo victim data");
    await unchangedExcept(before);

    // Cross-bound: the pinned employer's run with another tenant's employee reference matches
    // nothing in the pinned employer's ledger; refused for review with no write on either side.
    before = await snapshots();
    const crossVictimReference = await send(eventBody(a, { reference: "PAY-" + a.payout.run.id + "-" + victim.worker.employeeNo }));
    assert.equal(crossVictimReference.status, 409, crossVictimReference.text);
    assert.deepEqual(crossVictimReference.json, { error: "Settlement observation rejected; manual review required." });
    const crossVictimRun = await send(eventBody(a, { reference: "PAY-" + victim.payout.run.id + "-" + a.worker.employeeNo }));
    assert.equal(crossVictimRun.status, 404, crossVictimRun.text);
    assert.equal(crossVictimRun.text, unknown.text);
    await unchangedExcept(before);

    console.log(JSON.stringify({
      proof: "xendit-payout-webhook", ownRecorded: 2, replayDuplicates: 1, concurrentDuplicates: 1,
      foreignRefusals: 3, crossBoundRefusals: 2, forgedSelectorsIgnored: 1, authNegatives: 3,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-webhook-xendit-payout-http.mjs")) {
  proveXenditPayoutWebhook().catch(error => {
    console.error("XENDIT_PAYOUT_WEBHOOK_HTTP_FAILED: " + (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
