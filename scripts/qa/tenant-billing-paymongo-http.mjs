/**
 * One bounded GAP method: POST /api/billing, legacy one-off PayMongo checkout.
 * Two independent fictional owners, a genuine higher-id victim, persisted
 * own checkout positives, forged selectors, foreign denial, and immutable
 * victim PostgreSQL state. No real payment or provider network access.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { requireFictionalPaymongoEnv, RECEIPT } from "./tenant-billing-paymongo-preload.mjs";

export async function verifyTenantPaymongoCheckout() {
  // Refuse unsafe targets before importing any database or application module.
  requireFictionalPaymongoEnv();
  const [{ db, pool }, s, { asc, and, eq }, table] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);

  const scopedTables = {
    organization: [s.organizations, s.organizations.id],
    memberships: [s.userOrganizations, s.userOrganizations.organizationId],
    employees: [s.employees, s.employees.organizationId],
    payProfiles: [s.employeePayProfiles, s.employeePayProfiles.organizationId],
    subscriptions: [s.subscriptions, s.subscriptions.organizationId],
    invoices: [s.invoices, s.invoices.organizationId],
    payrollRuns: [s.payrollRuns, s.payrollRuns.organizationId],
    audit: [s.auditEvents, s.auditEvents.organizationId],
    outbox: [s.outbox, s.outbox.organizationId],
  };

  async function snapshot(organizationId) {
    const result = {};
    for (const [name, [tableSchema, field]] of Object.entries(scopedTables)) {
      result[name] = await db.select().from(tableSchema)
        .where(eq(field, organizationId)).orderBy(asc(tableSchema.id));
    }
    return JSON.parse(JSON.stringify(result));
  }

  const events = () => existsSync(RECEIPT)
    ? readFileSync(RECEIPT, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];

  const request = (actor, body, { cookie = actor?.cookie } = {}) =>
    table.standaloneRequest("/api/billing", {
      method: "POST", cookie, body,
    });

  function deny(response, expected, victim, label) {
    assert.equal(response.status, expected, label + ": " + response.text.slice(0, 250));
    assert.ok(!response.text.includes(victim.marker), label + ": victim marker leaked");
    assert.equal(response.json?.checkoutUrl, undefined, label + ": checkout link in denial");
    assert.equal(response.json?.invoice, undefined, label + ": invoice in denial");
  }

  try {
    const dbIdentity = (await pool.query(
      "SELECT current_database() AS database, current_setting('server_version_num')::int AS version"
    )).rows[0];
    assert.equal(dbIdentity.database, "app_db", "disposable app_db required");
    assert.equal(Math.floor(dbIdentity.version / 10000), 16, "PostgreSQL 16 required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "TENANT_PAYMONGO_REFUSED: empty fictional app_db required");
    assert.equal(events().length, 0, "No stale provider receipt is permitted");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await table.seedEmployer("ATTA", nonce, table.standaloneMakeSession);
    const b = await table.seedEmployer("ATTB", nonce, table.standaloneMakeSession);
    const victim = await table.seedEmployer("VICTIM", nonce, table.standaloneMakeSession);
    assert.equal(new Set([a.cookie, b.cookie, victim.cookie]).size, 3);
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
    assert.ok(victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);

    // Different nonempty financial baselines; victim invoices and subscriptions
    // must remain byte-for-byte unchanged after both attacks and own writes.
    for (const actor of [a, b, victim]) {
      const [invoice] = await db.insert(s.invoices).values({
        organizationId: actor.org.id, number: "CI-BASE-" + actor.org.id + "-" + nonce,
        amountCents: 75000, currency: "PHP", status: "open",
      }).returning();
      actor.baseInvoice = invoice;
    }
    const [subA] = await db.insert(s.subscriptions).values({
      organizationId: a.org.id, plan: "Core", status: "pending_payment",
      seatLimit: 10, amountCents: 150000, billingCycle: "monthly",
    }).returning();
    const [subVictim] = await db.insert(s.subscriptions).values({
      organizationId: victim.org.id, plan: "Enterprise", status: "active",
      provider: "paymongo", providerRef: "ci-existing-victim-" + nonce,
      seatLimit: 100, amountCents: 1299900, billingCycle: "monthly",
    }).returning();
    assert.ok(subVictim.id > subA.id, "Higher-id victim subscription required");
    const victimBefore = await snapshot(victim.org.id);
    const ownBefore = [await snapshot(a.org.id), await snapshot(b.org.id)];
    assert.ok(victimBefore.memberships.length && victimBefore.employees.length &&
      victimBefore.payProfiles.length && victimBefore.subscriptions.length &&
      victimBefore.invoices.length, "Nonempty victim records are mandatory");

    const invalidCookie = "__Host-linaw_session=fictional-invalid-cookie";
    deny(await request(null, { organizationId: victim.org.id, plan: "Core" }),
      401, victim, "anonymous cannot open victim checkout");
    deny(await request(null, { organizationId: victim.org.id, plan: "Core" },
      { cookie: invalidCookie }), 401, victim, "invalid session");
    assert.equal(events().length, 0, "Anonymous requests cannot reach provider");
    const crossSite = await fetch(process.env.SECURITY_SMOKE_URL + "/api/billing", {
      method: "POST", redirect: "manual",
      headers: {
        cookie: a.cookie, origin: "https://evil.example",
        "sec-fetch-site": "cross-site", "content-type": "application/json",
      },
      body: JSON.stringify({ organizationId: victim.org.id, plan: "Core" }),
    });
    assert.equal(crossSite.status, 403, "cross-site billing mutation must be denied");
    assert.ok(!(await crossSite.text()).includes(victim.marker));
    assert.equal(events().length, 0, "Cross-site request cannot reach provider");

    for (const actor of [a, b]) {
      const foreign = await request(actor, {
        organizationId: victim.org.id, plan: "Enterprise", billingCycle: "annual",
        subscriptionId: subVictim.id, invoiceId: victim.baseInvoice.id,
        legalEntityId: victim.entity.id,
      });
      deny(foreign, 403, victim, actor.label + " foreign checkout");
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        "Foreign request may not modify victim billing, payroll, audit, or outbox");
    }
    assert.equal(events().length, 0, "Foreign requests cannot reach provider");

    // A unit-limited billing role is not an employer-wide billing operator.
    await db.update(s.userOrganizations).set({ orgUnitId: a.unit.id })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id)));
    deny(await request(a, { organizationId: a.org.id, plan: "Core" }),
      403, victim, "unit-limited checkout denied");
    await db.update(s.userOrganizations).set({ orgUnitId: null })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id)));

    // A valid owner without recent MFA must not create a checkout.
    const [aSession] = await db.select().from(s.sessions)
      .where(eq(s.sessions.userId, a.owner.id)).limit(1);
    await db.update(s.sessions).set({ mfaVerifiedAt: null })
      .where(eq(s.sessions.id, aSession.id));
    deny(await request(a, { organizationId: a.org.id, plan: "Core" }),
      403, victim, "checkout without current MFA denied");
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, aSession.id));
    assert.equal(events().length, 0, "RBAC/MFA denials cannot create provider checkout");

    // Both owners have a genuinely successful and distinct checkout. A uses
    // the existing-subscription update path, B the insert path.
    let successCount = 0;
    for (const [actor, plan, cycle, amount] of [
      [a, "Core", "monthly", 150000],
      [b, "Scale", "annual", 4499000],
    ]) {
      const own = await request(actor, {
        organizationId: actor.org.id, plan, billingCycle: cycle,
        subscriptionId: subVictim.id, invoiceId: victim.baseInvoice.id,
        legalEntityId: victim.entity.id,
      });
      assert.equal(own.status, 201,
        actor.label + " owned checkout failed: " + own.text.slice(0, 300));
      assert.equal(own.json?.ok, true);
      assert.equal(own.json?.invoice?.status, "open");
      assert.match(own.json?.checkoutUrl ?? "",
        /^https:\/\/checkout\.paymongo\.com\/fictional-/);
      assert.ok(own.json.checkoutUrl.includes("fictional-" + actor.org.id + "-"));
      const after = await snapshot(actor.org.id);
      assert.equal(after.invoices.length, ownBefore[successCount].invoices.length + 1);
      assert.ok(after.invoices.some(i => i.id === own.json.invoice.id &&
        i.organizationId === actor.org.id && i.amountCents === amount &&
        i.status === "open"));
      assert.equal(after.subscriptions.length, 1);
      assert.equal(after.subscriptions[0].status, "pending_payment",
        "A checkout must NEVER mark an employer paid or activate a plan");
      assert.equal(after.subscriptions[0].provider, "paymongo");
      assert.ok(after.subscriptions[0].providerRef.startsWith("cs_ci_" + actor.org.id + "_"));
      assert.ok(after.audit.some(event => event.action === "Checkout session created"));
      assert.deepEqual(after.payrollRuns, ownBefore[successCount].payrollRuns);
      assert.deepEqual(after.payProfiles, ownBefore[successCount].payProfiles);
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        "Legitimate own checkout cannot mutate another employer");
      assert.equal(events().length, ++successCount);
      const event = events().at(-1);
      assert.equal(event.organizationId, actor.org.id);
      assert.equal(event.amountCents, amount);
      assert.equal(event.plan, plan);
      assert.equal(event.billingCycle, cycle);
      assert.ok(!events().some(item => item.organizationId === victim.org.id));
      // Route uses a time-based invoice number; separate checkout runs so the
      // test does not accidentally force same-millisecond IDs.
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    const result = {
      method: "POST /api/billing",
      postgresMajor: 16, independentOwnPositiveEmployers: 2,
      higherIdVictimPersisted: true, ownCheckout201: successCount,
      foreign403: 2, anonymous401: 2, crossSite403: 1,
      unitScopedDenied: true, mfaDenied: true,
      forgedForeignSelectorsIgnored: true,
      victimBusinessAndAuditUnchanged: true,
      noRealPaymongoOrMoneyMovement: true,
      productionTested: false, independentlyAccepted: false,
      coverageCredits: 0,
    };
    console.log("TENANT_PAYMONGO_CHECKOUT_HTTP_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-billing-paymongo-http.mjs")) {
  verifyTenantPaymongoCheckout().catch(error => {
    console.error("TENANT_PAYMONGO_CHECKOUT_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
