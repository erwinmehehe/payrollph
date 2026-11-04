/**
 * Proof only: Resend delivery callback, real localhost HTTP, fictional PG16.
 * A valid Svix signature is PLATFORM-scoped: it may report genuine A, B or victim deliveries.
 * Tenant containment is the stored outbox row: the event must name an outbox id AND the provider
 * message id that was stored when that row's send succeeded. Every refusal returns one shared body,
 * identical to the body for an outbox id that does not exist, so the callback is not an existence oracle.
 * Exact per-row duplicate detection, in-transaction audit receipts and a no-planted-message-id rule are
 * checked against the complete nine-employer cohort. There is no provider key, no provider call, no
 * production data and no coverage credit.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { requireDisposableResendWebhook } from "./tenant-webhook-resend-contract.mjs";

const ENDPOINT = "/api/webhooks/resend";
const RECEIPT_ACTION = "Email provider delivery event";
const EVENT_OCCURRED_AT = "2026-11-04T10:00:00.000Z";
const COHORT = ["ATTA", "ATTB", ...Array.from({ length: 6 }, (_, i) => "FILL" + i), "VICTIM"];

// A low or merely greater-than-attacker victim ID is insufficient for the frozen closure-plan rule.
// Check real persisted IDs for every relevant scope, including the outbox row the callback resolves.
export function assertFictionalHighIdVictim(a, b, victim, fillers = []) {
  const predecessors = [a, b, ...fillers];
  for (const field of ["org", "entity", "unit", "owner", "worker"]) {
    const id = victim[field]?.id;
    assert.ok(Number.isSafeInteger(id) && id > 6 &&
      predecessors.every(e => Number.isSafeInteger(e[field]?.id) && id > e[field].id),
    "Higher-ID real victim " + field + " must exceed six and every preceding employer");
  }
  const id = victim.mail?.sent?.id;
  assert.ok(Number.isSafeInteger(id) && id > 6 &&
    predecessors.every(e => Number.isSafeInteger(e.mail?.sent?.id) && id > e.mail.sent.id),
  "Higher-ID real victim outbox row must exceed six and every preceding employer");
}

// Compare the complete seeded cohort, including the six filler employers.
// An omitted employer snapshot is a proof failure, not a silent exemption.
export function assertEmployerSnapshotIsolation(before, after, allowed = []) {
  const expected = [...COHORT].sort();
  assert.deepEqual(Object.keys(before).sort(), expected, "All seeded employers must appear in the baseline snapshot");
  assert.deepEqual(Object.keys(after).sort(), expected, "All seeded employers must remain in the isolation snapshot");
  for (const label of allowed) {
    assert.ok(expected.includes(label), "Only seeded employers may be allowed to change");
    assert.deepEqual(Object.keys(after[label]).sort(), Object.keys(before[label]).sort(),
      label + ": no extra or missing snapshot tables");
    for (const [table, rows] of Object.entries(before[label])) {
      if (!["outbox", "auditEvents"].includes(table)) {
        assert.deepEqual(after[label][table], rows,
          label + ": only outbox and audit rows may change on an authorized callback (" + table + ")");
      }
    }
  }
  for (const [label, previous] of Object.entries(before)) {
    if (!allowed.includes(label)) {
      assert.deepEqual(after[label], previous, label + ": other employer outbox and audit rows unchanged");
    }
  }
}

/**
 * Bound an owned delivery to its declared row/column delta. Merely labeling an employer "allowed"
 * must not hide extra receipts, a rewritten message id or a second outbox row being touched.
 */
export function assertExpectedOwnedDelivery(before, after, label, expected) {
  const old = before[label];
  const current = after[label];
  assert.ok(old && current, "Owned employer snapshot must exist");
  assert.deepEqual(Object.keys(current).sort(), Object.keys(old).sort(), label + ": snapshot schema cannot change");
  const organizationId = old.outbox[0]?.organizationId;
  assert.ok(Number.isSafeInteger(organizationId), "Real stored owner organization required");
  const target = old.outbox.find(row => row.id === expected.outboxId);
  assert.ok(target, label + ": an authorized delivery must name a persisted outbox row");
  assert.ok(typeof expected.eventType === "string" && expected.eventType.startsWith("email."),
    label + ": expected signed provider event type required");
  assert.ok(typeof expected.occurredAt === "string" &&
    Number.isFinite(Date.parse(expected.occurredAt)) &&
    new Date(expected.occurredAt).toISOString() === expected.occurredAt,
  label + ": an exact ISO provider event timestamp is required");
  assert.deepEqual(current.employees, old.employees, label + ": a delivery callback cannot change employees");

  assert.equal(current.outbox.length, old.outbox.length, label + ": a callback never creates or removes outbox rows");
  const updatable = new Set(["deliveryStatus", "deliveryDetail", "deliveryUpdatedAt"]);
  let touched = 0;
  for (let i = 0; i < old.outbox.length; i++) {
    assert.equal(current.outbox[i].id, old.outbox[i].id, label + ": stable outbox row identity");
    if (old.outbox[i].id !== expected.outboxId) {
      assert.deepEqual(current.outbox[i], old.outbox[i], label + ": only the named outbox row may change");
      continue;
    }
    touched++;
    for (const column of new Set([...Object.keys(old.outbox[i]), ...Object.keys(current.outbox[i])])) {
      if (!updatable.has(column)) {
        assert.deepEqual(current.outbox[i][column], old.outbox[i][column],
          label + ": unexpected outbox." + column + " mutation (message id, provider, body and owner are fixed)");
      }
    }
    assert.equal(current.outbox[i].deliveryStatus, expected.deliveryStatus, label + ": delivery status");
    assert.equal(current.outbox[i].deliveryDetail, expected.deliveryDetail ?? null, label + ": delivery detail");
    assert.notEqual(current.outbox[i].deliveryUpdatedAt, old.outbox[i].deliveryUpdatedAt,
      label + ": an accepted delivery must actually update its event timestamp");
    assert.equal(current.outbox[i].deliveryUpdatedAt, expected.occurredAt,
      label + ": persisted timestamp must match the signed provider event");
  }
  assert.equal(touched, 1, label + ": the named outbox row must exist");

  const receipts = expected.receipts ?? 1;
  assert.equal(current.auditEvents.length, old.auditEvents.length + receipts,
    label + ": exactly " + receipts + " new delivery receipts");
  assert.deepEqual(current.auditEvents.slice(0, old.auditEvents.length), old.auditEvents,
    label + ": prior audit rows cannot be rewritten");
  for (const row of current.auditEvents.slice(old.auditEvents.length)) {
    assert.equal(row.organizationId, organizationId, label + ": new receipt must belong to the verified owner");
    assert.equal(row.action, RECEIPT_ACTION, label + ": receipt action");
    assert.equal(row.actor, "system:resend-webhook", label + ": receipt must identify the authenticated provider");
    assert.equal(row.resource, "outbox #" + expected.outboxId, label + ": receipt must name the delivered row");
    assert.equal(row.metadata?.eventId, expected.eventId, label + ": receipt must carry the provider event id");
    assert.equal(row.metadata?.provider, "resend", label + ": receipt provider");
    assert.equal(row.metadata?.providerMessageId, expected.providerMessageId, label + ": receipt message id");
    assert.equal(row.metadata?.deliveryStatus, expected.deliveryStatus, label + ": receipt status");
    assert.equal(row.metadata?.outboxId, expected.outboxId, label + ": receipt must name the persisted outbox id");
    assert.equal(row.metadata?.purpose, target.purpose, label + ": receipt must preserve the target message purpose");
    assert.equal(row.metadata?.eventType, expected.eventType, label + ": receipt must preserve signed event type");
    assert.equal(row.metadata?.occurredAt, expected.occurredAt, label + ": receipt must preserve signed event time");
    assert.equal(row.metadata?.detail, expected.deliveryDetail ?? null, label + ": receipt must preserve delivery detail");
  }
}

export async function proveResendWebhook() {
  // No application or database imports are permitted before this hard refusal.
  requireDisposableResendWebhook();
  const [database, s, drizzle, helpers] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { db, pool } = database;
  const { eq, asc, isNull } = drizzle;
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16,
      "RESEND_WEBHOOK_REFUSED: PostgreSQL 16 is required");
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "Only a fresh empty disposable database may be used");

    const a = await helpers.seedEmployer("ATTA", nonce, helpers.standaloneMakeSession);
    const b = await helpers.seedEmployer("ATTB", nonce, helpers.standaloneMakeSession);
    const fillers = [];
    for (let i = 0; i < 6; i++) fillers.push(await helpers.seedEmployer("FILL" + i, nonce, helpers.standaloneMakeSession));
    const victim = await helpers.seedEmployer("VICTIM", nonce, helpers.standaloneMakeSession);
    const employers = [a, b, ...fillers, victim];

    const messageId = (employer, tag) => "email_" + employer.label.toLowerCase() + "_" + tag + "_" + nonce;
    async function insertOutbox(organizationId, values) {
      const [row] = await db.insert(s.outbox).values({
        organizationId, recipient: "fictional@example.invalid", subject: "Fictional subject", body: "Fictional body",
        purpose: "payslip-ready", provider: "resend", status: "sent", deliveryStatus: "accepted", ...values,
      }).returning();
      return row;
    }
    // Every employer owns a genuinely sent row; A and B own a second one for the concurrency and rollback steps.
    for (const employer of employers) {
      employer.mail = { sent: await insertOutbox(employer.org.id, { providerMessageId: messageId(employer, "one") }) };
    }
    for (const employer of [a, b]) {
      employer.mail.second = await insertOutbox(employer.org.id, { providerMessageId: messageId(employer, "two") });
    }
    // The victim also owns a row that was never sent (no stored message id) and one sent by another provider.
    victim.mail.unsent = await insertOutbox(victim.org.id, {
      providerMessageId: null, status: "pending", deliveryStatus: "sending",
    });
    victim.mail.otherProvider = await insertOutbox(victim.org.id, {
      provider: "postmark", providerMessageId: messageId(victim, "postmark"),
    });
    const system = await insertOutbox(null, { purpose: "demo-request", providerMessageId: "email_system_" + nonce });
    assertFictionalHighIdVictim(a, b, victim, fillers);
    assert.ok(system.id > victim.mail.otherProvider.id, "system row is seeded last");

    async function employerState(employer) {
      const id = employer.org.id;
      const rows = async (table, column = table.organizationId) => db.select().from(table).where(eq(column, id)).orderBy(asc(table.id));
      return JSON.parse(JSON.stringify({
        outbox: await rows(s.outbox),
        auditEvents: await rows(s.auditEvents),
        employees: await rows(s.employees),
      }));
    }
    const snapshots = async () => ({
      ...Object.fromEntries(await Promise.all(employers.map(async e => [e.label, await employerState(e)]))),
    });
    // Unattributed rows are part of the isolation evidence too: no callback may create or change them,
    // except the one deliberate system-row step, which never touches an employer.
    const globalState = async () => JSON.parse(JSON.stringify({
      systemOutbox: await db.select().from(s.outbox).where(isNull(s.outbox.organizationId)).orderBy(asc(s.outbox.id)),
      outboxCount: (await pool.query("SELECT count(*)::int AS n FROM outbox")).rows[0].n,
    }));
    async function unchangedExcept(before, beforeGlobal, ...allowed) {
      const after = await snapshots();
      assertEmployerSnapshotIsolation(before, after, allowed);
      if (beforeGlobal) assert.deepEqual(await globalState(), beforeGlobal, "unattributed outbox rows and the row count are unchanged");
      return after;
    }

    const svixId = tag => "msg_" + tag + "_" + randomUUID().replaceAll("-", "");
    const nowSeconds = () => String(Math.floor(Date.now() / 1000));
    const sign = (id, timestamp, payload, signingKey = key) =>
      "v1," + createHmac("sha256", signingKey).update(id + "." + timestamp + "." + payload).digest("base64");
    function eventBody(outboxId, providerMessage, options = {}) {
      return {
        type: options.type ?? "email.delivered",
        created_at: options.createdAt ?? EVENT_OCCURRED_AT,
        data: {
          email_id: providerMessage,
          tags: options.tags ?? { app: "linaw", outbox_id: String(outboxId) },
          ...(options.bounce ? { bounce: { message: options.bounce } } : {}),
        },
      };
    }
    async function send(body, options = {}) {
      const payload = options.rawPayload ?? JSON.stringify(body);
      const id = options.id ?? svixId("evt");
      const timestamp = options.timestamp ?? nowSeconds();
      const headers = { "content-type": "application/json" };
      if (!options.noHeaders) {
        headers["svix-id"] = id;
        headers["svix-timestamp"] = timestamp;
        headers["svix-signature"] = options.signature ?? sign(id, timestamp, options.signedPayload ?? payload, options.key);
      }
      // Inbound callback only. No cookie and no Origin. No external provider fetch.
      const response = await fetch(new URL(ENDPOINT, process.env.SECURITY_SMOKE_URL), {
        method: "POST", headers, body: payload, redirect: "manual", cache: "no-store",
      });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: response.status, text, json, id };
    }
    const result = (response, expectedStatus, expectedBody, label) => {
      assert.equal(response.status, expectedStatus, label + ": " + response.text.slice(0, 200));
      assert.deepEqual(response.json, expectedBody, label + ": stable JSON response");
    };
    const counts = {
      authNegatives: 0, invalidPayloads: 0, ignoredEvents: 0, ownDeliveries: 0, duplicates: 0, oldReplayAfter520Receipts: 0,
      replayWithDifferentBodyIgnored: 0, crossBoundRefusals: 0, plantedMessageIdRefusals: 0, concurrentDuplicates: 0,
      auditAtomicRollbacks: 0, auditRetryRecovered: 0, systemRowOwn: 0, systemRowWrongIdRefused: 0,
      systemRowReplayNotDeduped: 0, providerAuthorityVictimOnly: 0,
    };

    // Authentication failures cannot be used as tenant coverage credit.
    let before = await snapshots();
    let beforeGlobal = await globalState();
    const valid = eventBody(a.mail.sent.id, a.mail.sent.providerMessageId);
    const unauthenticated = { error: "Invalid webhook signature." };
    result(await send(valid, { noHeaders: true }), 401, unauthenticated, "missing svix headers");
    result(await send(valid, { signature: "v1," + Buffer.alloc(32, 7).toString("base64") }), 401, unauthenticated, "forged signature");
    result(await send(valid, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) }), 401, unauthenticated, "stale timestamp");
    result(await send(valid, { signedPayload: JSON.stringify({ ...valid, type: "email.bounced" }) }), 401, unauthenticated, "signature over another payload");
    result(await send(valid, { key: Buffer.alloc(32, 9) }), 401, unauthenticated, "signature by another secret");
    counts.authNegatives += 5;
    // A correctly signed body that is not a JSON object is a client error, never a write.
    result(await send(null, { rawPayload: "{not json" }), 400, { error: "Invalid webhook payload." }, "signed invalid JSON");
    result(await send(null, { rawPayload: "null" }), 400, { error: "Invalid webhook payload." }, "signed JSON null");
    counts.invalidPayloads += 2;
    await unchangedExcept(before, beforeGlobal);

    // A correct signature does not make an unrecognized event authoritative either.
    before = await snapshots();
    beforeGlobal = await globalState();
    const ignored = { ok: true, ignored: true };
    result(await send(eventBody(victim.mail.sent.id, victim.mail.sent.providerMessageId, { type: "email.opened" })), 200, ignored, "signed unknown event type");
    result(await send(eventBody(victim.mail.sent.id, victim.mail.sent.providerMessageId, { tags: { app: "another-app", outbox_id: String(victim.mail.sent.id) } })), 200, ignored, "signed event for another app");
    result(await send(eventBody(victim.mail.sent.id, victim.mail.sent.providerMessageId, { tags: {} })), 200, ignored, "signed event without tags");
    for (const outboxId of ["0", "-1", "1.5", "abc", ""]) {
      result(await send(eventBody(victim.mail.sent.id, victim.mail.sent.providerMessageId, { tags: { app: "linaw", outbox_id: outboxId } })), 200, ignored, "signed event with invalid outbox id " + JSON.stringify(outboxId));
    }
    counts.ignoredEvents += 8;
    await unchangedExcept(before, beforeGlobal);

    // Own, authenticated, real-row positive: only A's named row and one A receipt change.
    before = await snapshots();
    beforeGlobal = await globalState();
    const ownId = svixId("a-own");
    const own = await send(eventBody(a.mail.sent.id, a.mail.sent.providerMessageId), { id: ownId });
    result(own, 200, { ok: true, matched: true, duplicate: false, outboxId: a.mail.sent.id }, "A own delivery");
    let after = await unchangedExcept(before, beforeGlobal, "ATTA");
    assertExpectedOwnedDelivery(before, after, "ATTA", {
      outboxId: a.mail.sent.id, deliveryStatus: "delivered", eventType: "email.delivered", occurredAt: EVENT_OCCURRED_AT, eventId: ownId,
      providerMessageId: a.mail.sent.providerMessageId, receipts: 1,
    });
    counts.ownDeliveries++;

    // The same provider event id again is a recognized duplicate and changes nothing.
    before = await snapshots();
    result(await send(eventBody(a.mail.sent.id, a.mail.sent.providerMessageId), { id: ownId }), 200,
      { ok: true, matched: true, duplicate: true, outboxId: a.mail.sent.id }, "same event replay");
    await unchangedExcept(before, beforeGlobal);
    counts.duplicates++;

    // Push more than 500 unrelated delivery receipts after A's event. The previous global 500-row window
    // forgot it; the exact per-row check must not. Replay with a DIFFERENT signed body: a replayed id can
    // never rewrite state.
    const noise = Array.from({ length: 520 }, (_, i) => ({
      organizationId: fillers[0].org.id, actor: "system:resend-webhook", action: RECEIPT_ACTION,
      resource: "outbox #" + fillers[0].mail.sent.id, metadata: { provider: "resend", eventId: "evt_noise_" + i + "_" + nonce },
    }));
    for (let i = 0; i < noise.length; i += 100) await db.insert(s.auditEvents).values(noise.slice(i, i + 100));
    before = await snapshots();
    result(await send(eventBody(a.mail.sent.id, a.mail.sent.providerMessageId, { type: "email.bounced", bounce: "Forged replay body" }), { id: ownId }), 200,
      { ok: true, matched: true, duplicate: true, outboxId: a.mail.sent.id }, "old replay after 520 unrelated receipts");
    after = await unchangedExcept(before, beforeGlobal);
    assert.equal(after.ATTA.outbox.find(r => r.id === a.mail.sent.id).deliveryStatus, "delivered",
      "an old replay must not rewrite delivery state");
    counts.oldReplayAfter520Receipts++;
    counts.replayWithDifferentBodyIgnored++;

    // Another genuine delivery with a detail string: B's own row only.
    before = await snapshots();
    const bounceId = svixId("b-own");
    result(await send(eventBody(b.mail.sent.id, b.mail.sent.providerMessageId, { type: "email.bounced", bounce: "Fictional mailbox full" }), { id: bounceId }), 200,
      { ok: true, matched: true, duplicate: false, outboxId: b.mail.sent.id }, "B own bounce");
    after = await unchangedExcept(before, beforeGlobal, "ATTB");
    assertExpectedOwnedDelivery(before, after, "ATTB", {
      outboxId: b.mail.sent.id, deliveryStatus: "bounced", deliveryDetail: "Fictional mailbox full", eventType: "email.bounced", occurredAt: EVENT_OCCURRED_AT, eventId: bounceId,
      providerMessageId: b.mail.sent.providerMessageId, receipts: 1,
    });
    counts.ownDeliveries++;

    // Cross-bound refusals. A validly signed event naming REAL other-employer rows with real or invented
    // message ids is refused with one body, identical to an outbox id that does not exist (no existence
    // oracle), and nothing anywhere changes. The planted-id case would have written the caller's message
    // id onto the victim's unsent row before the fix.
    before = await snapshots();
    beforeGlobal = await globalState();
    const missingRow = await send(eventBody(2_000_000_000, "email_invented_" + nonce));
    result(missingRow, 200, { ok: true, matched: false, duplicate: false }, "nonexistent outbox id");
    const plantedMessage = "email_planted_" + nonce;
    const refusals = [
      ["A message id on the victim row", victim.mail.sent.id, a.mail.sent.providerMessageId],
      ["victim message id on A's row", a.mail.sent.id, victim.mail.sent.providerMessageId],
      ["B message id on the victim row", victim.mail.sent.id, b.mail.sent.providerMessageId],
      ["invented message id on the victim row", victim.mail.sent.id, "email_invented_" + nonce],
      ["victim message id on B's second row", b.mail.second.id, victim.mail.sent.providerMessageId],
      ["a Resend event for a row sent by another provider", victim.mail.otherProvider.id, victim.mail.otherProvider.providerMessageId],
      ["a planted message id on the victim's unsent row", victim.mail.unsent.id, plantedMessage],
      ["an empty message id on the victim's unsent row", victim.mail.unsent.id, ""],
    ];
    for (const [label, outboxId, providerMessage] of refusals) {
      const refused = await send(eventBody(outboxId, providerMessage));
      assert.equal(refused.status, 200, label + ": " + refused.text.slice(0, 200));
      assert.equal(refused.text, missingRow.text, label + ": a real foreign row must not be distinguishable from a nonexistent row");
      counts.crossBoundRefusals++;
      if (label.includes("unsent")) counts.plantedMessageIdRefusals++;
    }
    after = await unchangedExcept(before, beforeGlobal);
    assert.equal(after.VICTIM.outbox.find(r => r.id === victim.mail.unsent.id).providerMessageId, null,
      "a signed event must not plant a provider message id on an unsent row");

    // Concurrent duplicates are serialized by the outbox row lock: exactly one write and one receipt.
    before = await snapshots();
    const raceId = svixId("b-race");
    const raceBody = eventBody(b.mail.second.id, b.mail.second.providerMessageId, { type: "email.delivery_delayed" });
    const raced = await Promise.all(Array.from({ length: 8 }, () => send(raceBody, { id: raceId })));
    assert.deepEqual(raced.map(r => r.status), Array(8).fill(200));
    assert.equal(raced.filter(r => r.json?.matched === true && r.json?.duplicate === false).length, 1,
      "concurrent duplicates must not double-write");
    assert.equal(raced.filter(r => r.json?.matched === true && r.json?.duplicate === true).length, 7);
    after = await unchangedExcept(before, beforeGlobal, "ATTB");
    assertExpectedOwnedDelivery(before, after, "ATTB", {
      outboxId: b.mail.second.id, deliveryStatus: "delayed", eventType: "email.delivery_delayed", occurredAt: EVENT_OCCURRED_AT, eventId: raceId,
      providerMessageId: b.mail.second.providerMessageId, receipts: 1,
    });
    counts.concurrentDuplicates++;

    // The audit receipt is part of the same transaction as the state update. Inject a real PostgreSQL trigger
    // failure on this disposable localhost-only database, then retry the same callback.
    const rollbackId = svixId("a-rollback");
    const rollbackBody = eventBody(a.mail.second.id, a.mail.second.providerMessageId);
    before = await snapshots();
    await pool.query(
      "CREATE FUNCTION public.ci_reject_resend_receipt() RETURNS trigger LANGUAGE plpgsql AS $ci_resend_audit$ " +
      "BEGIN IF NEW.action = 'Email provider delivery event' THEN " +
      "RAISE EXCEPTION 'CI_ONLY_RESEND_RECEIPT_REJECTED'; END IF; RETURN NEW; END $ci_resend_audit$"
    );
    await pool.query(
      "CREATE TRIGGER ci_reject_resend_receipt BEFORE INSERT ON public.audit_events " +
      "FOR EACH ROW EXECUTE FUNCTION public.ci_reject_resend_receipt()"
    );
    try {
      const rejected = await send(rollbackBody, { id: rollbackId });
      assert.equal(rejected.status, 500, "A rejected receipt insert must fail the complete callback so the provider retries");
      await unchangedExcept(before, beforeGlobal);
      counts.auditAtomicRollbacks++;
    } finally {
      await pool.query("DROP TRIGGER ci_reject_resend_receipt ON public.audit_events");
      await pool.query("DROP FUNCTION public.ci_reject_resend_receipt()");
    }
    // If the first transaction truly rolled back, the same provider event was never recorded as seen.
    before = await snapshots();
    result(await send(rollbackBody, { id: rollbackId }), 200,
      { ok: true, matched: true, duplicate: false, outboxId: a.mail.second.id }, "rolled-back callback recovers on retry");
    after = await unchangedExcept(before, beforeGlobal, "ATTA");
    assertExpectedOwnedDelivery(before, after, "ATTA", {
      outboxId: a.mail.second.id, deliveryStatus: "delivered", eventType: "email.delivered", occurredAt: EVENT_OCCURRED_AT, eventId: rollbackId,
      providerMessageId: a.mail.second.providerMessageId, receipts: 1,
    });
    counts.auditRetryRecovered++;
    before = await snapshots();
    result(await send(rollbackBody, { id: rollbackId }), 200,
      { ok: true, matched: true, duplicate: true, outboxId: a.mail.second.id }, "successful retry is idempotent");
    await unchangedExcept(before, beforeGlobal);

    // Honest characterization of a row that belongs to no employer (system email): a genuine event may
    // update it, a wrong id is refused, and because no employer receipt can be written for it there is
    // no duplicate protection. It never touches any employer.
    before = await snapshots();
    beforeGlobal = await globalState();
    const systemEvent = eventBody(system.id, system.providerMessageId);
    const systemId = svixId("system");
    result(await send(systemEvent, { id: systemId }), 200, { ok: true, matched: true, duplicate: false, outboxId: system.id }, "system row genuine event");
    await unchangedExcept(before, null);
    const systemAfter = await globalState();
    assert.equal(systemAfter.outboxCount, beforeGlobal.outboxCount);
    assert.deepEqual(systemAfter.systemOutbox.map(r => r.id), beforeGlobal.systemOutbox.map(r => r.id));
    assert.equal(systemAfter.systemOutbox.find(r => r.id === system.id).deliveryStatus, "delivered");
    counts.systemRowOwn++;
    result(await send(eventBody(system.id, "email_wrong_" + nonce)), 200, { ok: true, matched: false, duplicate: false }, "system row wrong id");
    assert.deepEqual((await globalState()).systemOutbox, systemAfter.systemOutbox, "a refused event leaves the system row unchanged");
    counts.systemRowWrongIdRefused++;
    result(await send(systemEvent, { id: systemId }), 200, { ok: true, matched: true, duplicate: false, outboxId: system.id },
      "system row replay is applied again (no employer receipt exists to deduplicate it)");
    await unchangedExcept(before, null);
    assert.deepEqual((await globalState()).systemOutbox, systemAfter.systemOutbox, "the replay rewrote the same state only");
    counts.systemRowReplayNotDeduped++;

    // Honest characterization, not tenant credit: the signing secret is platform-wide, so a fully
    // well-formed event for the victim's own row is the provider reporting the victim's own delivery.
    // It must affect the victim only.
    before = await snapshots();
    beforeGlobal = await globalState();
    const victimId = svixId("victim-own");
    result(await send(eventBody(victim.mail.sent.id, victim.mail.sent.providerMessageId), { id: victimId }), 200,
      { ok: true, matched: true, duplicate: false, outboxId: victim.mail.sent.id }, "victim own delivery");
    after = await unchangedExcept(before, beforeGlobal, "VICTIM");
    assertExpectedOwnedDelivery(before, after, "VICTIM", {
      outboxId: victim.mail.sent.id, deliveryStatus: "delivered", eventType: "email.delivered", occurredAt: EVENT_OCCURRED_AT, eventId: victimId,
      providerMessageId: victim.mail.sent.providerMessageId, receipts: 1,
    });
    assert.equal(after.VICTIM.outbox.find(r => r.id === victim.mail.unsent.id).providerMessageId, null);
    counts.providerAuthorityVictimOnly++;

    console.log(JSON.stringify({
      proof: "resend-webhook",
      ...counts,
      productionTested: false,
      certified: false,
      methodCoverageCredit: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-webhook-resend-http.mjs")) {
  proveResendWebhook().catch(error => {
    console.error("RESEND_WEBHOOK_PROOF_FAILED: " + (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
