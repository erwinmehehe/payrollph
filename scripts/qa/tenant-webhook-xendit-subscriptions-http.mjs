/**
 * Proof only: Xendit subscription callback, real localhost HTTP, fictional PG16.
 * A valid callback token + merchant id is PLATFORM-scoped: it may report genuine A, B or victim
 * subscriptions. Tenant containment is the stored checkout (reference id AND plan id), the
 * authorized amount/currency, and the newest-plan guard. Cross-bound pairs must be refused with
 * one shared body and no write. Billing is enabled only in this CI job; there is no provider key.
 * No provider call, bank connection, production data or coverage credit.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { requireDisposableXenditSubscriptionsWebhook } from "./tenant-webhook-xendit-subscriptions-contract.mjs";

const ENDPOINT = "/api/webhooks/xendit/subscriptions";
const AMOUNT_CENTS = 150000;

export async function proveXenditSubscriptionsWebhook() {
  // No application or database imports are permitted before this hard refusal.
  requireDisposableXenditSubscriptionsWebhook();
  const [database, s, billing, drizzle, helpers] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("../../src/lib/saas-billing-schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { db, pool } = database;
  const { eq, asc } = drizzle;
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const token = process.env.XENDIT_CALLBACK_TOKEN;
  const businessId = process.env.XENDIT_BUSINESS_ID;
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16,
      "XENDIT_SUBSCRIPTIONS_WEBHOOK_REFUSED: PostgreSQL 16 is required");
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "Only a fresh empty disposable database may be used");

    const a = await helpers.seedEmployer("ATTA", nonce, helpers.standaloneMakeSession);
    const b = await helpers.seedEmployer("ATTB", nonce, helpers.standaloneMakeSession);
    const victim = await helpers.seedEmployer("VICTIM", nonce, helpers.standaloneMakeSession);
    const employers = [a, b, victim];
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id, "victim employer must have higher real ID");

    async function seedCheckout(employer) {
      const [subscription] = await db.insert(s.subscriptions).values({
        organizationId: employer.org.id, plan: "Core", status: "trialing", seatLimit: 10,
        amountCents: 0, currency: "PHP",
      }).returning();
      const [checkout] = await db.insert(billing.saasBillingCheckouts).values({
        organizationId: employer.org.id, subscriptionId: subscription.id,
        referenceId: "ref-" + employer.label.toLowerCase() + "-" + nonce,
        providerPlanId: "plan-" + employer.label.toLowerCase() + "-" + nonce,
        plan: "Core", seats: 10, amountCents: AMOUNT_CENTS, currency: "PHP", status: "awaiting_payment",
      }).returning();
      return { subscription, checkout, referenceId: checkout.referenceId, planId: checkout.providerPlanId };
    }
    for (const employer of employers) employer.billing = await seedCheckout(employer);
    // A's earlier, superseded checkout: its callbacks must never reactivate the newer plan.
    const [oldCheckout] = await db.insert(billing.saasBillingCheckouts).values({
      organizationId: a.org.id, subscriptionId: a.billing.subscription.id,
      referenceId: "ref-old-atta-" + nonce, providerPlanId: "plan-old-atta-" + nonce,
      plan: "Core", seats: 10, amountCents: AMOUNT_CENTS, currency: "PHP", status: "superseded",
    }).returning();
    assert.ok(victim.billing.subscription.id > a.billing.subscription.id && victim.billing.subscription.id > b.billing.subscription.id,
      "real victim subscription ID must exceed both attacker subscription IDs");
    assert.ok(victim.billing.checkout.id > a.billing.checkout.id && victim.billing.checkout.id > b.billing.checkout.id,
      "real victim checkout ID must exceed both attacker checkout IDs");

    async function employerState(employer) {
      const id = employer.org.id;
      const rows = async table => db.select().from(table).where(eq(table.organizationId, id)).orderBy(asc(table.id));
      return JSON.parse(JSON.stringify({
        subscriptions: await rows(s.subscriptions),
        invoices: await rows(s.invoices),
        auditEvents: await rows(s.auditEvents),
        checkouts: await rows(billing.saasBillingCheckouts),
        billingState: await db.select().from(billing.saasBillingState).where(eq(billing.saasBillingState.organizationId, id)),
        billingEvents: await rows(billing.saasBillingEvents),
        employees: await rows(s.employees),
      }));
    }
    const snapshots = async () => Object.fromEntries(await Promise.all(
      employers.map(async e => [e.label, await employerState(e)])
    ));
    async function unchangedExcept(before, ...allowed) {
      const after = await snapshots();
      for (const e of employers) {
        if (!allowed.includes(e.label)) {
          assert.deepEqual(after[e.label], before[e.label], e.label + ": other employer billing and audit rows unchanged");
        }
      }
      return after;
    }

    const cycleId = (employer, n) => "cycle-" + employer.label.toLowerCase() + "-" + n + "-" + nonce;
    function eventBody(employer, options = {}) {
      const event = options.event ?? "recurring.cycle.succeeded";
      const planId = options.planId ?? employer.billing.planId;
      const isCycle = event.startsWith("recurring.cycle.");
      return {
        event,
        business_id: options.businessId ?? businessId,
        // Extra caller-supplied tenant selectors are not authority.
        organizationId: options.organizationId,
        subscriptionId: options.subscriptionId,
        data: {
          id: isCycle ? (options.cycleId === undefined ? cycleId(employer, options.n ?? 1) : options.cycleId) : planId,
          plan_id: planId,
          reference_id: options.referenceId ?? employer.billing.referenceId,
          amount: options.amount ?? AMOUNT_CENTS / 100,
          currency: options.currency ?? "PHP",
          status: options.status ?? (event === "recurring.cycle.succeeded" ? "SUCCEEDED" : "FAILED"),
          scheduled_timestamp: new Date().toISOString(),
          organization_id: options.organizationId,
          organizationId: options.organizationId,
          subscription_id: options.subscriptionId,
          subscriptionId: options.subscriptionId,
          legalEntityId: options.legalEntityId,
        },
      };
    }
    async function send(body, { missingToken = false, wrongToken = false } = {}) {
      const raw = JSON.stringify(body);
      const headers = { "content-type": "application/json" };
      if (!missingToken) headers["x-callback-token"] = wrongToken ? "0".repeat(token.length) : token;
      // Inbound callback only. No cookie and no Origin. No external provider fetch.
      const response = await fetch(new URL(ENDPOINT, process.env.SECURITY_SMOKE_URL), {
        method: "POST", headers, body: raw, redirect: "manual", cache: "no-store",
      });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: response.status, text, json };
    }
    const result = (response, expectedStatus, expectedBody, label) => {
      assert.equal(response.status, expectedStatus, label + ": " + response.text.slice(0, 200));
      assert.deepEqual(response.json, expectedBody, label + ": stable JSON response");
    };
    const invoiceNumber = (planId, cycle) =>
      "XS-" + createHash("sha256").update(planId + ":" + cycle).digest("hex").slice(0, 22).toUpperCase();
    const counts = {
      ownPaid: 0, ownPastDue: 0, duplicates: 0, concurrentDuplicates: 0, forgedSelectorsIgnored: 0,
      stalePlanIgnored: 0, amountCurrencyRefusals: 0, crossBoundRefusals: 0, authNegatives: 0,
      providerAuthorityVictimOnly: 0,
    };

    // Authentication failures cannot be used as tenant coverage credit.
    let before = await snapshots();
    result(await send(eventBody(a), { missingToken: true }), 401, { error: "Webhook authentication failed." }, "missing token");
    result(await send(eventBody(a), { wrongToken: true }), 401, { error: "Webhook authentication failed." }, "wrong token");
    result(await send(eventBody(a, { businessId: "biz-synthetic-" + "0".repeat(16) })), 403,
      { error: "Incorrect billing merchant." }, "wrong merchant");
    counts.authNegatives += 3;
    await unchangedExcept(before);

    // Own, authenticated, real-row positive: the callback resolves A's checkout by reference + plan;
    // only A's billing event, state, subscription, checkout, invoice and audit rows change.
    before = await snapshots();
    const ownEvent = eventBody(a, { n: 1 });
    const own = await send(ownEvent);
    result(own, 200, { received: true, handled: true, status: "paid" }, "A own paid cycle");
    let after = await unchangedExcept(before, "ATTA");
    assert.equal(after.ATTA.billingEvents.length, before.ATTA.billingEvents.length + 1);
    assert.equal(after.ATTA.invoices.length, before.ATTA.invoices.length + 1);
    assert.equal(after.ATTA.auditEvents.length, before.ATTA.auditEvents.length + 1);
    const ownEventRow = after.ATTA.billingEvents.at(-1);
    assert.deepEqual([ownEventRow.organizationId, ownEventRow.providerPlanId, ownEventRow.eventType],
      [a.org.id, a.billing.planId, "recurring.cycle.succeeded"]);
    const ownInvoice = after.ATTA.invoices.at(-1);
    assert.deepEqual([ownInvoice.organizationId, ownInvoice.subscriptionId, ownInvoice.number, ownInvoice.status, ownInvoice.amountCents],
      [a.org.id, a.billing.subscription.id, invoiceNumber(a.billing.planId, cycleId(a, 1)), "paid", AMOUNT_CENTS]);
    const ownSubscription = after.ATTA.subscriptions[0];
    assert.deepEqual([ownSubscription.status, ownSubscription.provider, ownSubscription.providerRef, ownSubscription.amountCents],
      ["active", "xendit", a.billing.planId, AMOUNT_CENTS]);
    assert.equal(after.ATTA.billingState.length, 1);
    assert.deepEqual([after.ATTA.billingState[0].providerPlanId, after.ATTA.billingState[0].lastPaidCycleId],
      [a.billing.planId, cycleId(a, 1)]);
    assert.equal(after.ATTA.checkouts.find(c => c.id === a.billing.checkout.id).status, "active");
    const ownAudit = after.ATTA.auditEvents.at(-1);
    assert.deepEqual([ownAudit.action, ownAudit.actor, ownAudit.resource],
      ["recurring.cycle.succeeded", "Xendit verified webhook", "Subscription " + a.billing.subscription.id]);
    counts.ownPaid++;

    before = await snapshots();
    result(await send(ownEvent), 200, { received: true, handled: false, duplicate: true }, "same event replay");
    await unchangedExcept(before);
    counts.duplicates++;

    // A valid provider may report B's own subscription too; the shared token must not attach it elsewhere.
    before = await snapshots();
    result(await send(eventBody(b, { n: 1 })), 200, { received: true, handled: true, status: "paid" }, "B own paid cycle");
    after = await unchangedExcept(before, "ATTB");
    assert.equal(after.ATTB.invoices.length, before.ATTB.invoices.length + 1);
    assert.equal(after.ATTB.billingEvents.at(-1).organizationId, b.org.id);
    counts.ownPaid++;

    // Forged selectors ignored: A's failed cycle wins even when top-level and nested organization,
    // subscription and entity selectors try to name the real higher-ID victim.
    before = await snapshots();
    const forged = await send(eventBody(a, {
      event: "recurring.cycle.failed", n: 2,
      organizationId: victim.org.id, subscriptionId: victim.billing.subscription.id,
      legalEntityId: victim.entity.id,
    }));
    result(forged, 200, { received: true, handled: true, status: "past_due" }, "forged selectors ignored");
    after = await unchangedExcept(before, "ATTA");
    assert.equal(after.ATTA.subscriptions[0].status, "past_due");
    assert.equal(after.ATTA.billingEvents.at(-1).organizationId, a.org.id);
    assert.equal(after.ATTA.billingEvents.length, before.ATTA.billingEvents.length + 1);
    counts.forgedSelectorsIgnored++;
    counts.ownPastDue++;

    // Concurrent duplicates are serialized by the unique provider event key.
    before = await snapshots();
    const simultaneous = eventBody(b, { n: 2 });
    const raced = await Promise.all([send(simultaneous), send(simultaneous)]);
    assert.deepEqual(raced.map(r => r.status), [200, 200]);
    assert.deepEqual(raced.map(r => r.json?.duplicate ? "duplicate" : r.json?.handled ? "handled" : "error").sort(),
      ["duplicate", "handled"], "concurrent duplicates must not double-write");
    after = await unchangedExcept(before, "ATTB");
    assert.equal(after.ATTB.billingEvents.length, before.ATTB.billingEvents.length + 1);
    assert.equal(after.ATTB.invoices.length, before.ATTB.invoices.length + 1);
    assert.equal(after.ATTB.auditEvents.length, before.ATTB.auditEvents.length + 1);
    counts.concurrentDuplicates++;

    // A superseded plan cannot reactivate the newer plan: it only leaves its own dedupe row.
    before = await snapshots();
    const stale = await send(eventBody(a, {
      event: "recurring.plan.activated", planId: oldCheckout.providerPlanId, referenceId: oldCheckout.referenceId,
    }));
    result(stale, 200, { received: true, handled: false, stale: true }, "stale plan ignored");
    after = await unchangedExcept(before, "ATTA");
    assert.deepEqual(after.ATTA.subscriptions, before.ATTA.subscriptions, "stale callback must not change the subscription");
    assert.deepEqual(after.ATTA.billingState, before.ATTA.billingState, "stale callback must not change billing state");
    assert.deepEqual(after.ATTA.invoices, before.ATTA.invoices);
    assert.deepEqual(after.ATTA.checkouts, before.ATTA.checkouts);
    counts.stalePlanIgnored++;

    // Cross-bound pairs: all authenticated, all naming REAL other-employer references or plans.
    // The route cannot find a checkout for the pair, so it refuses with one shared body that is
    // identical for a pair that does not exist at all (no existence oracle). 503 never counts.
    before = await snapshots();
    const unknownPair = await send(eventBody(a, {
      referenceId: "ref-invented-" + nonce, planId: "plan-invented-" + nonce, n: 3,
    }));
    assert.equal(unknownPair.status, 503);
    assert.deepEqual(unknownPair.json, { error: "Subscription is not reconciled yet." });
    for (const payload of [
      eventBody(a, { planId: victim.billing.planId, n: 3 }), // A reference, victim plan
      eventBody(victim, { planId: a.billing.planId, n: 3 }), // victim reference, A plan
      eventBody(b, { planId: victim.billing.planId, n: 3 }), // B reference, victim plan
      eventBody(a, { referenceId: victim.billing.referenceId, n: 3 }), // victim reference, A plan
    ]) {
      const refused = await send(payload);
      assert.equal(refused.status, 503, "cross-bound pair must be refused: " + refused.text.slice(0, 200));
      assert.equal(refused.text, unknownPair.text, "a real foreign pair must not be distinguishable from a nonexistent pair");
      counts.crossBoundRefusals++;
    }
    await unchangedExcept(before);

    // Authorized amount and currency are bound to the checkout. Real victim pair, valid token,
    // wrong amount or currency or no cycle id: refused with no write anywhere.
    before = await snapshots();
    const mismatch = { error: "Subscription payment does not match the authorized amount or currency." };
    result(await send(eventBody(victim, { amount: AMOUNT_CENTS / 100 + 1 })), 422, mismatch, "victim wrong amount");
    result(await send(eventBody(victim, { currency: "USD" })), 422, mismatch, "victim wrong currency");
    result(await send(eventBody(a, { amount: 1, n: 4 })), 422, mismatch, "A wrong amount");
    result(await send(eventBody(victim, { cycleId: "" })), 422, { error: "Cycle ID missing." }, "victim missing cycle id");
    counts.amountCurrencyRefusals += 4;
    await unchangedExcept(before);

    // Honest characterization, not tenant credit: the callback token is platform-wide, so a fully
    // well-formed event for the victim's own checkout is the provider reporting the victim's own
    // subscription. It must affect the victim only.
    before = await snapshots();
    result(await send(eventBody(victim, { n: 1 })), 200, { received: true, handled: true, status: "paid" }, "victim own paid cycle");
    after = await unchangedExcept(before, "VICTIM");
    assert.equal(after.VICTIM.invoices.length, before.VICTIM.invoices.length + 1);
    assert.equal(after.VICTIM.billingEvents.at(-1).organizationId, victim.org.id);
    counts.providerAuthorityVictimOnly++;

    console.log(JSON.stringify({
      proof: "xendit-subscriptions-webhook",
      ...counts,
      productionTested: false,
      certified: false,
      methodCoverageCredit: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-webhook-xendit-subscriptions-http.mjs")) {
  proveXenditSubscriptionsWebhook().catch(error => {
    console.error("XENDIT_SUBSCRIPTIONS_WEBHOOK_PROOF_FAILED: " + (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
