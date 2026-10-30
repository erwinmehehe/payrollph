/**
 * EDG-02: ID-existence and tenant ownership regression for PATCH /api/it-operations.
 * Zero manifest credits. Must execute only against fictional PG16 and localhost
 * production-mode Next.js, with no live credentials or external providers.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export function requireDisposableItPatch(env = process.env) {
  const expected = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(env[key], value, "EDG02_IT_REFUSED: " + key);
  }
  for (const key of [
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY", "DATABASE_AUTH_TOKEN",
    "SMTP_URL", "SLACK_BOT_TOKEN",
  ]) {
    assert.ok(!env[key], "EDG02_IT_REFUSED: external credential " + key);
  }
}

export function assertDenied(response, expected, victimMarker, label) {
  assert.equal(response.status, expected,
    label + ": unexpected status " + response.status + " " + response.text.slice(0, 150));
  assert.ok(!response.text.includes(victimMarker), label + ": victim body leak");
  for (const [key, value] of response.headers) {
    assert.ok(!(key + ":" + value).includes(victimMarker), label + ": victim header leak");
  }
}

export async function proveItOperationsPatch() {
  // Nothing importing app code or the DB can run before this refusal gate.
  requireDisposableItPatch();
  const [{ db, pool }, schema, { eq, asc }, http] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const s = schema;
  const byOrg = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const snapshot = async (orgId) => {
    const [apps, grants, assets, devices, events, audit, workers, memberships] =
      await Promise.all([
        byOrg(s.itApplications, orgId), byOrg(s.itAccessGrants, orgId),
        byOrg(s.assets, orgId), byOrg(s.itManagedDevices, orgId),
        byOrg(s.itDeviceEvents, orgId), byOrg(s.auditEvents, orgId),
        byOrg(s.employees, orgId), byOrg(s.userOrganizations, orgId),
      ]);
    return { apps, grants, assets, devices, events, audit, workers, memberships };
  };
  const patch = (actor, body) => http.standaloneRequest("/api/it-operations", {
    method: "PATCH", cookie: actor?.cookie, body,
  });

  try {
    for (const table of [s.organizations, s.itApplications, s.itAccessGrants,
      s.assets, s.itManagedDevices, s.auditEvents]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "EDG02_IT_REFUSED: PostgreSQL must be fresh and empty");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const a = await http.seedEmployer("ATTA", nonce, http.standaloneMakeSession);
    const b = await http.seedEmployer("ATTB", nonce, http.standaloneMakeSession);
    const victim = await http.seedEmployer("VICTIM", nonce, http.standaloneMakeSession);

    async function seedDeviceSet(employer, suffix) {
      const org = employer.org.id;
      const [app] = await db.insert(s.itApplications).values({
        organizationId: org, name: employer.marker + " app " + suffix,
      }).returning();
      const [grant] = await db.insert(s.itAccessGrants).values({
        organizationId: org, employeeId: employer.worker.id,
        applicationId: app.id, state: "grant_requested",
      }).returning();
      const [asset] = await db.insert(s.assets).values({
        organizationId: org, employeeId: employer.worker.id,
        type: "laptop", name: employer.marker + " laptop " + suffix, status: "assigned",
      }).returning();
      const [device] = await db.insert(s.itManagedDevices).values({
        organizationId: org, assetId: asset.id,
        employeeId: employer.worker.id, state: "assigned",
      }).returning();
      const [spareAsset] = await db.insert(s.assets).values({
        organizationId: org, type: "laptop",
        name: employer.marker + " available laptop " + suffix, status: "returned",
      }).returning();
      const [available] = await db.insert(s.itManagedDevices).values({
        organizationId: org, assetId: spareAsset.id, state: "available",
      }).returning();
      return { app, grant, asset, device, spareAsset, available };
    }

    a.data = await seedDeviceSet(a, "main");
    b.data = await seedDeviceSet(b, "main");
    // Real SQL rows, not made-up missing IDs. Victim object IDs are > 6.
    for (let n = 0; n < 7; n++) await seedDeviceSet(victim, "padding-" + n);
    victim.data = await seedDeviceSet(victim, "confidential");
    for (const actor of [a, b]) {
      assert.ok(victim.org.id > actor.org.id);
      for (const key of ["grant", "device", "available"]) {
        assert.ok(victim.data[key].id > 6 && victim.data[key].id > actor.data[key].id,
          "Victim " + key + " must be a populated higher SQL ID");
      }
    }
    const victimBefore = await snapshot(victim.org.id);
    const ready = await fetch(process.env.SECURITY_SMOKE_URL + "/login");
    assert.equal(ready.status, 200, "Next must be running locally before probes");

    // No session may reach a mutation, even for a real victim object.
    assertDenied(await patch(null, {
      organizationId: victim.org.id, action: "access",
      id: victim.data.grant.id, state: "active",
    }), 401, victim.marker, "anonymous");

    for (const actor of [a, b]) {
      const ownBefore = await snapshot(actor.org.id);
      const deniedProbes = [
        ["access foreign ID under own tenant", {
          organizationId: actor.org.id, action: "access",
          id: victim.data.grant.id, state: "active",
        }, 404],
        ["device foreign ID under own tenant", {
          organizationId: actor.org.id, action: "device",
          id: victim.data.device.id, state: "return_requested",
        }, 404],
        ["access foreign tenant context", {
          organizationId: victim.org.id, action: "access",
          id: victim.data.grant.id, state: "active",
        }, 403],
        ["device foreign tenant context", {
          organizationId: victim.org.id, action: "device",
          id: victim.data.device.id, state: "return_requested",
        }, 403],
        ["foreign tenant with own ID", {
          organizationId: victim.org.id, action: "access",
          id: actor.data.grant.id, state: "active",
        }, 403],
        ["legacy foreign grant with omitted employer", {
          action: "access", id: victim.data.grant.id, state: "active",
        }, 403],
        ["legacy missing grant with omitted employer", {
          action: "access", id: 99999999, state: "active",
        }, 403],
        ["legacy foreign device with omitted employer", {
          action: "device", id: victim.data.device.id, state: "return_requested",
        }, 403],
        ["legacy missing device with omitted employer", {
          action: "device", id: 99999999, state: "return_requested",
        }, 403],
        ["invalid employer selector", {
          organizationId: 0, action: "device",
          id: victim.data.device.id, state: "return_requested",
        }, 422],
        ["nonexistent ID under own tenant", {
          organizationId: actor.org.id, action: "access",
          id: 99999999, state: "active",
        }, 404],
        ["foreign employee selector on available own device", {
          organizationId: actor.org.id, action: "device",
          id: actor.data.available.id, state: "assigned", employeeId: victim.worker.id,
        }, 404],
      ];
      const legacyDenials = new Map();
      for (const [label, body, status] of deniedProbes) {
        const res = await patch(actor, body);
        assertDenied(res, status, victim.marker, actor.label + " " + label);
        if (label.startsWith("legacy ")) legacyDenials.set(label, { status: res.status, text: res.text });
        assert.deepEqual(await snapshot(victim.org.id), victimBefore,
          label + ": victim grants, devices, assets, audit and events unchanged");
        assert.deepEqual(await snapshot(actor.org.id), ownBefore,
          label + ": denials must not change the attacker's own records either");
      }
      assert.deepEqual(legacyDenials.get("legacy foreign grant with omitted employer"),
        legacyDenials.get("legacy missing grant with omitted employer"),
        "Legacy grant requests must reveal neither foreign ID existence nor absence");
      assert.deepEqual(legacyDenials.get("legacy foreign device with omitted employer"),
        legacyDenials.get("legacy missing device with omitted employer"),
        "Legacy device requests must reveal neither foreign ID existence nor absence");

      // Valid controls prove the gate did not merely turn the route off.
      const grantRes = await patch(actor, {
        organizationId: actor.org.id, action: "access",
        id: actor.data.grant.id, state: "active",
      });
      assert.equal(grantRes.status, 200, "real own grant must transition");
      assert.equal(grantRes.json?.id, actor.data.grant.id);
      assert.equal(grantRes.json?.organizationId, actor.org.id);
      assert.equal(grantRes.json?.state, "active");

      const assignRes = await patch(actor, {
        organizationId: actor.org.id, action: "device",
        id: actor.data.available.id, state: "assigned", employeeId: actor.worker.id,
      });
      assert.equal(assignRes.status, 200, "real own available device must assign");
      assert.equal(assignRes.json?.id, actor.data.available.id);
      assert.equal(assignRes.json?.organizationId, actor.org.id);
      assert.equal(assignRes.json?.employeeId, actor.worker.id);
      assert.equal(assignRes.json?.state, "assigned");

      const returnRes = await patch(actor, {
        organizationId: actor.org.id, action: "device",
        id: actor.data.device.id, state: "return_requested",
      });
      assert.equal(returnRes.status, 200, "real own device return must succeed");
      assert.equal(returnRes.json?.state, "return_requested");
      const after = await snapshot(actor.org.id);
      assert.equal(after.grants.find(x => x.id === actor.data.grant.id).state, "active");
      assert.equal(after.grants.find(x => x.id === actor.data.grant.id).confirmedByUserId, actor.owner.id);
      assert.equal(after.devices.find(x => x.id === actor.data.device.id).state, "return_requested");
      assert.equal(after.devices.find(x => x.id === actor.data.available.id).state, "assigned");
      assert.equal(after.assets.find(x => x.id === actor.data.spareAsset.id).employeeId, actor.worker.id);
      assert.equal(after.events.length, ownBefore.events.length + 2,
        "each valid device transition must append one own event");
      assert.equal(after.audit.length, ownBefore.audit.length + 3,
        "each valid mutation must append one own audit");
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        "victim remains identical after real successful attacker-owned transitions");
    }
    // An account belonging to two employers must never silently infer an
    // employer from a legacy ID-only request, even when its own object exists.
    await db.insert(s.userOrganizations).values({
      userId: a.owner.id, organizationId: b.org.id, role: "owner", active: true,
    });
    const secondEmployerBefore = await snapshot(b.org.id);
    const ambiguous = await patch(a, {
      action: "access", id: a.data.grant.id, state: "revoke_requested",
    });
    assertDenied(ambiguous, 422, victim.marker, "multi-employer omitted selector");
    assert.deepEqual(await snapshot(b.org.id), secondEmployerBefore,
      "ambiguous employer must not change the other employer");
    assert.deepEqual(await snapshot(victim.org.id), victimBefore,
      "ambiguous employer must leave the victim unchanged");

    console.log("PASS EDG-02 IT PATCH employer-first lookup: two attackers, higher-ID victim, real own writes, uniform legacy denies, ambiguous employer rejected, unchanged victim DB; ZERO METHOD CREDITS");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-it-operations-patch-http.mjs")) {
  proveItOperationsPatch().catch(error => {
    console.error("EDG02_IT_PATCH_PROOF_FAILED:", error);
    process.exitCode = 1;
  });
}
