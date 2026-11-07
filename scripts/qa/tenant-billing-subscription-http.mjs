/**
 * Real localhost HTTP + disposable PG16 proof of the TWO money-adjacent
 * subscription mutations: start and cancel. Every identity is fictional.
 * The server's Xendit traffic is handled by an egress-blocking preloader.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { requireFictionalProviderEnv, RECEIPT } from "./tenant-billing-subscription-provider-preload.mjs";

export async function verifyTenantSubscriptionMutations() {
  // MUST run before importing any application, provider or database module.
  requireFictionalProviderEnv();
  const [{ db, pool }, s, billing, { eq, asc }, { hashPassword }, table] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("../../src/lib/saas-billing-schema.ts"),
    import("drizzle-orm"),
    import("../../src/lib/crypto.ts"),
    import("./tenant-table-http.mjs"),
  ]);

  const request = (actor, path, body, method = "POST") =>
    table.standaloneRequest(path, { method, cookie: actor?.cookie, body });
  const events = () => existsSync(RECEIPT)
    ? readFileSync(RECEIPT, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  const ownPaths = {
    start: "/api/billing/subscription/start",
    cancel: "/api/billing/subscription/cancel",
  };
  const tables = [
    ["subscriptions", s.subscriptions],
    ["checkouts", billing.saasBillingCheckouts],
    ["billingState", billing.saasBillingState],
    ["invoices", s.invoices],
    ["audit", s.auditEvents],
    ["payrollRuns", s.payrollRuns],
    ["yearEndAdjustments", s.yearEndAdjustments],
  ];
  async function snapshot(orgId) {
    const result = {};
    for (const [label, tableSchema] of tables) {
      const q = db.select().from(tableSchema).where(eq(tableSchema.organizationId, orgId));
      result[label] = await (tableSchema.id ? q.orderBy(asc(tableSchema.id)) : q);
    }
    return JSON.parse(JSON.stringify(result));
  }
  function deny(response, code, target, label) {
    assert.equal(response.status, code, label + ": " + response.text.slice(0, 300));
    assert.ok(!response.text.includes(target.marker), label + ": victim employer marker leaked");
    assert.ok(!response.json?.checkoutUrl, label + ": denial returned a checkout link");
  }
  try {
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "TENANT_SUBSCRIPTION_REFUSED: new empty fictional database required");
    assert.equal(events().length, 0, "TENANT_SUBSCRIPTION_REFUSED: provider receipt must start empty");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await table.seedEmployer("ATTA", nonce, table.standaloneMakeSession);
    const b = await table.seedEmployer("ATTB", nonce, table.standaloneMakeSession);
    const victim = await table.seedEmployer("VICTIM", nonce, table.standaloneMakeSession);
    const subjects = [a, b, victim];
    assert.equal(new Set(subjects.map(item => item.cookie)).size, 3);
    for (const field of ["org", "worker", "owner", "entity"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "Victim " + field + " must have real persisted higher ID");
    }
    for (const employer of subjects) {
      const [sub] = await db.insert(s.subscriptions).values({
        organizationId: employer.org.id, plan: "Core", status: "pending_payment",
        seatLimit: 10, amountCents: 200000, billingCycle: "monthly", currency: "PHP",
      }).returning();
      employer.sub = sub;
    }

    const victimBeforeStart = await snapshot(victim.org.id);
    deny(await request(null, ownPaths.start, { organizationId: victim.org.id }),
      401, victim, "anonymous checkout");
    for (const actor of [a, b]) {
      deny(await request(actor, ownPaths.start, { organizationId: victim.org.id }),
        403, victim, actor.label + " foreign checkout");
      assert.deepEqual(await snapshot(victim.org.id), victimBeforeStart,
        "Foreign checkout cannot touch victim billing, payroll or audits");
    }
    assert.equal(events().length, 0, "Denied checkout must never reach provider");
    let successfulStarts = 0;
    for (const actor of [a, b]) {
      const own = await request(actor, ownPaths.start, { organizationId: actor.org.id });
      assert.equal(own.status, 201, "Owned checkout must really create a session: " + own.text.slice(0, 250));
      assert.equal(own.json?.ok, true);
      assert.equal(own.json?.amountCents, 200000);
      assert.equal(own.json?.currency, "PHP");
      assert.match(own.json?.checkoutUrl ?? "", /^https:\/\/checkout\.xendit\.co\/linaw_sub_/);
      const current = await snapshot(actor.org.id);
      assert.equal(current.subscriptions.length, 1);
      assert.equal(current.subscriptions[0].status, "pending_payment",
        "Provider session alone never activates a subscription");
      assert.equal(current.checkouts.length, 1);
      assert.equal(current.checkouts[0].status, "awaiting_payment");
      assert.equal(current.checkouts[0].organizationId, actor.org.id);
      assert.equal(current.checkouts[0].amountCents, 200000);
      assert.equal(current.audit.at(-1)?.action, "Recurring hosted subscription checkout created");
      assert.equal(events().filter(item => item.kind === "start").length, ++successfulStarts);
      const again = await request(actor, ownPaths.start, { organizationId: actor.org.id });
      assert.equal(again.status, 200, "Repeated checkout must reuse existing session");
      assert.equal(again.json?.existing, true);
      assert.equal(again.json?.checkoutUrl, own.json.checkoutUrl);
      assert.equal(events().filter(item => item.kind === "start").length, successfulStarts,
        "Duplicate request must not create a second provider session");
      assert.deepEqual(await snapshot(victim.org.id), victimBeforeStart,
        "Successful own checkout cannot touch victim employer");
    }

    // Recreate fictional *verified* paid state only in PG16. No provider webhook,
    // real money, subscription activation or customer record is involved.
    const paidThrough = new Date("2027-01-01T00:00:00.000Z");
    const passphrase = "disposable-billing-only-passphrase";
    for (const employer of subjects) {
      const providerRef = employer === victim
        ? "repl_ci_victim_" + employer.org.id
        : (await db.select().from(s.subscriptions)
            .where(eq(s.subscriptions.organizationId, employer.org.id)).limit(1))[0].providerRef;
      assert.match(providerRef, /^repl_ci_[a-zA-Z0-9_-]+$/);
      await db.update(s.subscriptions).set({
        status: "active", provider: "xendit", providerRef, periodEnd: paidThrough,
      }).where(eq(s.subscriptions.id, employer.sub.id));
      await db.insert(billing.saasBillingState).values({
        organizationId: employer.org.id, subscriptionId: employer.sub.id,
        providerPlanId: providerRef, paidThrough,
      });
      await db.update(s.users).set({ passwordHash: hashPassword(passphrase) })
        .where(eq(s.users.id, employer.owner.id));
    }
    const victimBeforeCancel = await snapshot(victim.org.id);
    let successfulCancels = 0;
    for (const actor of [a, b]) {
      const foreign = await request(actor, ownPaths.cancel, {
        organizationId: victim.org.id, currentPassword: passphrase,
      });
      deny(foreign, 403, victim, actor.label + " foreign cancellation");
      assert.deepEqual(await snapshot(victim.org.id), victimBeforeCancel,
        "Foreign cancellation cannot mutate any victim row or audit");
      const badPass = await request(actor, ownPaths.cancel, {
        organizationId: actor.org.id, currentPassword: "wrong-disposable-password",
      });
      deny(badPass, 403, victim, "incorrect own cancellation password");
      const priorOwn = await snapshot(actor.org.id);
      const cancelled = await request(actor, ownPaths.cancel, {
        organizationId: actor.org.id, currentPassword: passphrase,
      });
      assert.equal(cancelled.status, 200, "Owned cancellation must actually succeed: " + cancelled.text.slice(0, 250));
      assert.equal(cancelled.json?.automaticRenewal, false);
      assert.equal(cancelled.json?.accessUntil, paidThrough.toISOString());
      const after = await snapshot(actor.org.id);
      assert.equal(after.billingState[0].cancelAtPeriodEnd, true);
      assert.equal(after.subscriptions[0].status, "cancel_at_period_end");
      assert.deepEqual(after.invoices, priorOwn.invoices, "Cancellation cannot create an invoice");
      assert.deepEqual(after.payrollRuns, priorOwn.payrollRuns, "Cancellation cannot alter payroll");
      assert.deepEqual(after.yearEndAdjustments, priorOwn.yearEndAdjustments,
        "Cancellation cannot alter taxes");
      assert.equal(after.audit.at(-1)?.action, "Subscription automatic renewal cancelled");
      assert.equal(events().filter(item => item.kind === "cancel").length, ++successfulCancels);
      const replay = await request(actor, ownPaths.cancel, {
        organizationId: actor.org.id, currentPassword: passphrase,
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.json?.alreadyCancelled, true);
      assert.equal(events().filter(item => item.kind === "cancel").length, successfulCancels,
        "Repeated cancellation must not call the provider again");
      assert.deepEqual(await snapshot(victim.org.id), victimBeforeCancel,
        "Owned and denied cancellations leave victim untouched");
    }
    assert.equal(events().filter(item => item.kind === "start").length, 2);
    assert.equal(events().filter(item => item.kind === "cancel").length, 2);
    const result = {
      methodKeys: ["POST billing/subscription/start", "POST billing/subscription/cancel"],
      fictionalEmployers: 3, independentlyAuthenticatedAttackers: 2,
      higherIdVictim: true, realOwnedCheckout201: 2,
      realForeignCheckout403: 2, realOwnedCancellation200: 2,
      realForeignCancellation403: 2, retryWithoutDuplicateProviderCalls: true,
      noRealProviderOrPayoutOrPayroll: true,
      victimSqlAndAuditUnchanged: true, methodCredits: 0, productionCertified: false,
    };
    console.log("TENANT_SUBSCRIPTION_HTTP_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-billing-subscription-http.mjs")) {
  verifyTenantSubscriptionMutations().catch(error => {
    console.error("TENANT_SUBSCRIPTION_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
