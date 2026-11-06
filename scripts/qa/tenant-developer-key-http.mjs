/**
 * DEV lane: real Next HTTP + disposable PG16, two independent attacker tenants.
 * NO webhooks are created/dispatched; only create-key and revoke-key are proved.
 * POST /api/developer stays GAP; zero new method credits or rollout authority.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  requireDeveloperKeyProofEnvironment, requireHttpStatus,
  assertOneTimeKeyCreated, assertForeignKeyDenial,
} from "./tenant-developer-key-contract.mjs";

requireDeveloperKeyProofEnvironment(); // Fail before importing any database code.
const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
  import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);

const hash = (value) => createHash("sha256").update(value).digest("hex");
const base = process.env.SECURITY_SMOKE_URL;

async function request(path, { cookie, body, crossSite = false } = {}) {
  const method = body === undefined ? "GET" : "POST";
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) {
    headers.origin = base;
    headers["sec-fetch-site"] = crossSite ? "cross-site" : "same-origin";
    headers["content-type"] = "application/json";
  }
  const response = await fetch(new URL(path, base), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* explicit JSON assertion below */ }
  return { status: response.status, headers: response.headers, text, json };
}
function noVictimLeak(response, victim, key) {
  const result = response.text + JSON.stringify([...response.headers.entries()]);
  for (const marker of [victim.marker, victim.owner.email, key.name, key.prefix, key.keyHash]) {
    assert.ok(!result.includes(marker), "victim identifier or key record disclosed");
  }
}
async function snapshotOrganization(organizationId) {
  const [{ id } = {}] = await db.select({ id: s.organizations.id })
    .from(s.organizations).where(eq(s.organizations.id, organizationId));
  assert.equal(id, organizationId, "real employer required");
  const [organizations, employees, keys, endpoints, deliveries, audit, memberships] = await Promise.all([
    db.select().from(s.organizations).where(eq(s.organizations.id, organizationId)),
    db.select().from(s.employees).where(eq(s.employees.organizationId, organizationId)).orderBy(asc(s.employees.id)),
    db.select().from(s.apiKeys).where(eq(s.apiKeys.organizationId, organizationId)).orderBy(asc(s.apiKeys.id)),
    db.select().from(s.webhookEndpoints).where(eq(s.webhookEndpoints.organizationId, organizationId)).orderBy(asc(s.webhookEndpoints.id)),
    db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.organizationId, organizationId)).orderBy(asc(s.webhookDeliveries.id)),
    db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, organizationId)).orderBy(asc(s.auditEvents.id)),
    db.select().from(s.userOrganizations).where(eq(s.userOrganizations.organizationId, organizationId)).orderBy(asc(s.userOrganizations.id)),
  ]);
  return { organizations, employees, keys, endpoints, deliveries, audit, memberships };
}
async function selectKey(id) {
  const [row] = await db.select().from(s.apiKeys).where(eq(s.apiKeys.id, id)).limit(1);
  assert.ok(row, "a real PostgreSQL API key is required");
  return row;
}
function action(organizationId, verb, extra = {}) {
  return { organizationId, action: verb, ...extra };
}

async function verify() {
  // No source data or production secrets. All employers and credentials are fictional.
  assert.deepEqual(await db.select({ id: s.organizations.id }).from(s.organizations).limit(1), [],
    "disposable clean PG16 database required");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  for (let i = 0; i < 7; i++) {
    const padding = await fixture.seedEmployer("DEV_PAD" + i, nonce, fixture.standaloneMakeSession);
    await db.insert(s.apiKeys).values({
      organizationId: padding.org.id, name: "fictional padding key",
      prefix: "sk_pad_" + i, keyHash: hash("padding-only-" + i + "-" + nonce),
      scopes: ["employees:read"],
    });
  }
  const a = await fixture.seedEmployer("DEV_A", nonce, fixture.standaloneMakeSession);
  const b = await fixture.seedEmployer("DEV_B", nonce, fixture.standaloneMakeSession);
  const victim = await fixture.seedEmployer("DEV_VICTIM", nonce, fixture.standaloneMakeSession);
  assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id && victim.org.id > 6);
  assert.ok(victim.worker.id > a.worker.id && victim.worker.id > b.worker.id && victim.worker.id > 6);
  const [victimKey] = await db.insert(s.apiKeys).values({
    organizationId: victim.org.id, name: "VICTIM_ONLY_KEY_" + nonce,
    prefix: "vk_" + nonce, keyHash: hash("victim-key-marker-only-" + nonce),
    scopes: ["employees:read"],
  }).returning();
  assert.ok(victimKey.id > 6, "victim credential ID must be a real higher-numbered SQL key");
  // A fictional endpoint is stored only to verify isolation, never contacted.
  await db.insert(s.webhookEndpoints).values({
    organizationId: victim.org.id, url: "https://sink.example.invalid/" + nonce,
    secret: "FICTIONAL_NEVER_SEND_" + nonce, events: ["payroll.processed"],
  });
  const victimBefore = await snapshotOrganization(victim.org.id);
  const [victimSessionsBefore] = await Promise.all([
    db.select().from(s.sessions).where(eq(s.sessions.userId, victim.owner.id)).orderBy(asc(s.sessions.id)),
  ]);
  const ownCreatedIds = new Set();

  // Two distinct auth sessions and two genuine owned credential-creation positives.
  for (const actor of [a, b]) {
    const ownName = "DEV_OWN_" + actor.label + "_" + nonce;
    const created = requireHttpStatus(await request("/api/developer", {
      cookie: actor.cookie,
      body: action(actor.org.id, "create-key", {
        name: ownName, scopes: ["employees:read", "payroll:read"],
      }),
    }), 201, "owner creates one real key");
    assertOneTimeKeyCreated(created, ownName);
    ownCreatedIds.add(created.json.id);
    const ownKey = await selectKey(created.json.id);
    assert.equal(ownKey.organizationId, actor.org.id);
    assert.equal(ownKey.keyHash, hash(created.json.key), "one-time token must be stored only as SHA-256");
    assert.equal(ownKey.prefix, created.json.key.slice(0, 12));
    assert.equal(ownKey.revokedAt, null);
    assert.ok(ownKey.scopes.includes("employees:read"));

    const listed = requireHttpStatus(await request("/api/developer?organizationId=" +
      actor.org.id, { cookie: actor.cookie }), 200, "own developer key list");
    assert.ok(listed.json.apiKeys.some(row => row.id === ownKey.id && row.prefix === ownKey.prefix),
      "real own credential missing from permitted list");
    assert.ok(!listed.text.includes(created.json.key), "one-time plaintext cannot reappear on GET");
    assert.ok(!listed.text.includes(ownKey.keyHash), "GET must not expose stored key hash");
    noVictimLeak(listed, victim, victimKey);

    // Untrusted userId/target selectors must not redirect creation to the victim.
    const forged = requireHttpStatus(await request("/api/developer", {
      cookie: actor.cookie,
      body: action(actor.org.id, "create-key", {
        name: "DEV_FORGED_" + actor.label + "_" + nonce,
        scopes: ["employees:read"], userId: victim.owner.id,
        employeeId: victim.worker.id, targetOrganizationId: victim.org.id,
        keyId: victimKey.id,
      }),
    }), 201, "forged target key remains in own employer");
    assert.equal((await selectKey(forged.json.id)).organizationId, actor.org.id);
    assert.notEqual(forged.json.id, victimKey.id);

    // Attempt a real victim-key revoke through an attacker-owned organization.
    // The foreign and a genuinely nonexistent key must be indistinguishable.
    const stateBeforeDenials = await snapshotOrganization(actor.org.id);
    const foreignKey = await request("/api/developer", {
      cookie: actor.cookie,
      body: action(actor.org.id, "revoke-key", { keyId: victimKey.id }),
    });
    const missingKey = await request("/api/developer", {
      cookie: actor.cookie,
      body: action(actor.org.id, "revoke-key", { keyId: 2147483647 }),
    });
    assertForeignKeyDenial(foreignKey, missingKey, victimKey.id);
    noVictimLeak(foreignKey, victim, victimKey);

    for (const verb of ["create-key", "revoke-key"]) {
      const ownAction = verb === "create-key"
        ? { name: "foreign-org-forbidden" } : { keyId: victimKey.id };
      const cross = requireHttpStatus(await request("/api/developer", {
        cookie: actor.cookie, body: action(victim.org.id, verb, ownAction),
      }), 403, "foreign employer action forbidden");
      const absent = requireHttpStatus(await request("/api/developer", {
        cookie: actor.cookie, body: action(2147483647, verb, ownAction),
      }), 403, "unknown employer action forbidden");
      assert.deepEqual(cross.json, absent.json, "foreign employer must not be an existence oracle");
      noVictimLeak(cross, victim, victimKey);
    }
    requireHttpStatus(await request("/api/developer?organizationId=" + victim.org.id,
      { cookie: actor.cookie }), 403, "foreign developer key list forbidden");
    requireHttpStatus(await request("/api/developer", {
      cookie: actor.cookie, crossSite: true,
      body: action(actor.org.id, "create-key", { name: "cross-site-forbidden" }),
    }), 403, "cross-site credential creation rejected");
    assert.deepEqual(await snapshotOrganization(actor.org.id), stateBeforeDenials,
      "denied probes must not create credentials or audit receipts");

    // A unit-scoped administrator cannot inherit company-wide credential rights.
    await db.update(s.userOrganizations).set({ role: "admin", orgUnitId: actor.unit.id })
      .where(and(eq(s.userOrganizations.userId, actor.owner.id),
        eq(s.userOrganizations.organizationId, actor.org.id)));
    const unitBefore = await snapshotOrganization(actor.org.id);
    requireHttpStatus(await request("/api/developer?organizationId=" + actor.org.id,
      { cookie: actor.cookie }), 403, "unit admin developer list denied");
    requireHttpStatus(await request("/api/developer", {
      cookie: actor.cookie, body: action(actor.org.id, "create-key", { name: "unit-forbidden" }),
    }), 403, "unit admin cannot mint keys");
    requireHttpStatus(await request("/api/developer", {
      cookie: actor.cookie, body: action(actor.org.id, "revoke-key", { keyId: ownKey.id }),
    }), 403, "unit admin cannot revoke keys");
    assert.deepEqual(await snapshotOrganization(actor.org.id), unitBefore,
      "unit denials must leave keys and audits untouched");
    await db.update(s.userOrganizations).set({ role: "owner", orgUnitId: null })
      .where(and(eq(s.userOrganizations.userId, actor.owner.id),
        eq(s.userOrganizations.organizationId, actor.org.id)));

    // Prove a legitimate owner can revoke their own key with one receipt.
    requireHttpStatus(await request("/api/developer", {
      cookie: actor.cookie, body: action(actor.org.id, "revoke-key", { keyId: ownKey.id }),
    }), 200, "own key revoked");
    const revoked = await selectKey(ownKey.id);
    assert.ok(revoked.revokedAt instanceof Date, "owned key must really be revoked in PostgreSQL");
    const receipts = await db.select().from(s.auditEvents).where(and(
      eq(s.auditEvents.organizationId, actor.org.id),
      eq(s.auditEvents.action, "API key revoked"),
    ));
    assert.equal(receipts.length, 1, "exactly one owner audit receipt for revocation");
    assert.ok(!JSON.stringify(receipts).includes(created.json.key), "plaintext key in audit log");

    // Revocation of the signed-in user's active employer membership, without
    // deleting their session, denies both reads and writes on the same cookie.
    const [currentSession] = await db.select().from(s.sessions).where(and(
      eq(s.sessions.userId, actor.owner.id),
    )).limit(1);
    assert.ok(currentSession, "same live session must exist before grant revocation");
    await db.update(s.userOrganizations).set({ active: false }).where(and(
      eq(s.userOrganizations.userId, actor.owner.id),
      eq(s.userOrganizations.organizationId, actor.org.id)));
    const afterGrantRevoked = await snapshotOrganization(actor.org.id);
    const accountAfterRevocation = requireHttpStatus(await request("/api/account",
      { cookie: actor.cookie }), 200, "same session survives employer grant revocation");
    assert.equal(accountAfterRevocation.json.profile.id, actor.owner.id,
      "must remain the same authenticated actor");
    requireHttpStatus(await request("/api/developer?organizationId=" + actor.org.id,
      { cookie: actor.cookie }), 403, "revoked grant denies list");
    requireHttpStatus(await request("/api/developer", {
      cookie: actor.cookie, body: action(actor.org.id, "create-key", { name: "revoked-forbidden" }),
    }), 403, "revoked grant denies mint");
    requireHttpStatus(await request("/api/developer", {
      cookie: actor.cookie, body: action(actor.org.id, "revoke-key", { keyId: forged.json.id }),
    }), 403, "revoked grant denies revocation");
    assert.deepEqual(await snapshotOrganization(actor.org.id), afterGrantRevoked,
      "revoked membership requests cannot modify credentials, audit or webhooks");
    assert.deepEqual(await snapshotOrganization(victim.org.id), victimBefore,
      "higher-ID victim SQL must be immutable across owner/foreign/unit/revoked probes");
    assert.equal((await selectKey(victimKey.id)).revokedAt, null,
      "victim API key must remain usable only by the victim");
  }
  assert.equal(ownCreatedIds.size, 2, "two independent valid owner API key creations required");
  assert.deepEqual(await db.select().from(s.sessions)
    .where(eq(s.sessions.userId, victim.owner.id)).orderBy(asc(s.sessions.id)),
  victimSessionsBefore, "victim sessions must not change");

  console.log(JSON.stringify({
    kind: "TENANT_DEVELOPER_API_KEYS_POST", proof: "fictional-PG16-real-production-HTTP",
    result: "PASS", independentAttackers: 2, ownedCreateAndRevoke: 2,
    realHigherIdVictim: true, foreignExistingAndMissingParity: true,
    bodySelectorForgeryConfinedToOwnEmployer: true, originGate: true,
    unitScopeAndRevokedMembershipDenied: true, victimSqlAndAuditUnchanged: true,
    webhookDeliveryAttempted: false, production: false,
    POST_method_status: "GAP", newCoverageCredits: 0, independentlyApproved: false,
  }));
}

try { await verify(); } finally { await pool.end(); }
