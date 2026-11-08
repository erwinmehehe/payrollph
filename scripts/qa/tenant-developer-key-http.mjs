/**
 * DEV lane: real Next HTTP + disposable PG16, two independent attacker tenants.
 * NO webhooks are created/dispatched; only create-key and revoke-key are proved.
 * POST /api/developer stays GAP; zero new method credits or rollout authority.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {readFileSync} from 'node:fs';
import {securityWriteRun,requireSecurityWrite,assertSecurityDatabase,securityReceipt,withSecurityVeto} from './tenant-security-write-local-contract.mjs';
import {
  requireDeveloperKeyProofEnvironment, requireHttpStatus,
  assertOneTimeKeyCreated, assertForeignKeyDenial,
} from "./tenant-developer-key-contract.mjs";

if(securityWriteRun())requireSecurityWrite();else requireDeveloperKeyProofEnvironment(); // Before DB imports.
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
// Exercise the actual consumer route, not only the credential management API.
// This is a read-only employees scope with no webhook dispatch or provider calls.
async function apiEmployeeList(token, query, useApiKeyHeader = false) {
  const headers = useApiKeyHeader
    ? { "x-api-key": token }
    : { authorization: "Bearer " + token };
  const response = await fetch(new URL("/api/v1/employees" + query, base), {
    headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* checked by requireHttpStatus */ }
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
  if(securityWriteRun())await assertSecurityDatabase(pool);
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
    if(securityWriteRun())await db.insert(s.webhookEndpoints).values({organizationId:padding.org.id,
      url:'https://hooks.fixture.invalid/fictional/PADDING_'+i,secret:'fixture-padding-'+i,events:['payroll.processed']});
  }
  const a = await fixture.seedEmployer("DEV_A", nonce, fixture.standaloneMakeSession);
  const b = await fixture.seedEmployer("DEV_B", nonce, fixture.standaloneMakeSession);
  const victim = await fixture.seedEmployer("DEV_VICTIM", nonce, fixture.standaloneMakeSession);
  assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id && victim.org.id > 6);
  assert.ok(victim.worker.id > a.worker.id && victim.worker.id > b.worker.id && victim.worker.id > 6);
  const createdByOrg=new Map(),hooksByOrg=new Map();
  if(securityWriteRun())for(const actor of [a,b]){
    const created=requireHttpStatus(await request('/api/developer',{cookie:actor.cookie,
      body:action(actor.org.id,'create-key',{name:'DEV_OWN_'+actor.label+'_'+nonce,scopes:['employees:read','payroll:read']})}),201,'first owned key precedes real victim');
    createdByOrg.set(actor.org.id,created);
    const hook=requireHttpStatus(await request('/api/developer',{cookie:actor.cookie,
      body:action(actor.org.id,'create-webhook',{url:'https://hooks.fixture.invalid/fictional/'+actor.marker,
        events:['payroll.processed'],targetOrganizationId:victim.org.id,userId:victim.owner.id})}),201,'first owned endpoint precedes real victim');
    hooksByOrg.set(actor.org.id,hook);
  }
  const [victimKey] = await db.insert(s.apiKeys).values({
    organizationId: victim.org.id, name: "VICTIM_ONLY_KEY_" + nonce,
    prefix: "vk_" + nonce, keyHash: hash("victim-key-marker-only-" + nonce),
    scopes: ["employees:read"],
  }).returning();
  assert.ok(victimKey.id > 6, "victim credential ID must be a real higher-numbered SQL key");
  if(securityWriteRun())assert.ok([...createdByOrg.values()].every(r=>victimKey.id>r.json.id),'victim key must exceed both owned comparator keys');
  // A fictional endpoint is stored only to verify isolation, never contacted.
  const [victimEndpoint]=await db.insert(s.webhookEndpoints).values({
    organizationId: victim.org.id, url: securityWriteRun()?'https://hooks.fixture.invalid/fictional/VICTIM_'+nonce:"https://sink.example.invalid/" + nonce,
    secret: "FICTIONAL_NEVER_SEND_" + nonce, events: ["payroll.processed"],
  }).returning();
  if(securityWriteRun()){
    assert.ok(victimEndpoint.id>6&&[...hooksByOrg.values()].every(r=>victimEndpoint.id>r.json.id));
    const victimControl=requireHttpStatus(await request('/api/developer',{cookie:victim.cookie,
      body:action(victim.org.id,'test-webhook')}),200,'real victim endpoint is genuinely operational');
    assert.equal(victimControl.json.attempted,1);assert.equal(victimControl.json.results[0].status,'delivered');
  }
  const victimBefore = await snapshotOrganization(victim.org.id);
  const [victimSessionsBefore] = await Promise.all([
    db.select().from(s.sessions).where(eq(s.sessions.userId, victim.owner.id)).orderBy(asc(s.sessions.id)),
  ]);
  const ownCreatedIds = new Set();
  let webhookCreates=0,webhookTests=0,mutationDiscriminators=0,auditRollbacks=0;

  // Two distinct auth sessions and two genuine owned credential-creation positives.
  for (const actor of [a, b]) {
    const ownName = "DEV_OWN_" + actor.label + "_" + nonce;
    const created = createdByOrg.get(actor.org.id)??requireHttpStatus(await request("/api/developer", {
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
    assert.throws(()=>assertOneTimeKeyCreated(created,victimKey.name),undefined,
      "developer validator accepts another employer's data");mutationDiscriminators++;
    assert.ok(ownKey.scopes.includes("employees:read"));

    const listed = requireHttpStatus(await request("/api/developer?organizationId=" +
      actor.org.id, { cookie: actor.cookie }), 200, "own developer key list");
    assert.ok(listed.json.apiKeys.some(row => row.id === ownKey.id && row.prefix === ownKey.prefix),
      "real own credential missing from permitted list");
    assert.ok(!listed.text.includes(created.json.key), "one-time plaintext cannot reappear on GET");
    assert.ok(!listed.text.includes(ownKey.keyHash), "GET must not expose stored key hash");
    noVictimLeak(listed, victim, victimKey);

    // A freshly created employees:read key is usable as an API credential, but
    // cannot change its employer by supplying the higher-ID victim selector.
    const credentialRead = requireHttpStatus(await apiEmployeeList(
      created.json.key, "?organizationId=" + victim.org.id,
    ), 200, "new key reads only own employees despite forged employer selector");
    assert.equal(credentialRead.json.total, 1, "only the genuine key-owner employee is visible");
    assert.equal(credentialRead.json.data.length, 1);
    assert.equal(credentialRead.json.data[0].id, actor.worker.id);
    assert.equal(credentialRead.json.data[0].lastName, actor.worker.lastName);
    noVictimLeak(credentialRead, victim, victimKey);
    assert.ok(!credentialRead.text.includes(created.json.key), "the API may not echo the bearer secret");
    assert.ok(!credentialRead.text.includes(ownKey.keyHash), "the API may not reveal the stored hash");
    const afterCredentialRead = await selectKey(ownKey.id);
    assert.ok(afterCredentialRead.lastUsedAt instanceof Date,
      "the actual API consumer must record use of the fresh credential");

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

    for (const verb of (securityWriteRun()?["create-key", "revoke-key","create-webhook","test-webhook"]:["create-key", "revoke-key"])) {
      const ownAction = verb === "create-key"
        ? { name: "foreign-org-forbidden" } : verb==='create-webhook'?
          {url:'https://hooks.fixture.invalid/fictional/'+actor.marker,events:['payroll.processed']}:
          verb==='test-webhook'?{endpointId:victimEndpoint.id}:{ keyId: victimKey.id };
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

    if(securityWriteRun()){
      const url='https://hooks.fixture.invalid/fictional/'+actor.marker;
      // Prove all previously missing webhook sub-actions, through the real
      // request handler and persisted delivery ledger. Transport is reserved-host only.
      const createdHook=hooksByOrg.get(actor.org.id);
      assert.equal(createdHook.status,201);
      const [endpoint]=await db.select().from(s.webhookEndpoints).where(eq(s.webhookEndpoints.id,createdHook.json.id));
      assert.equal(endpoint.organizationId,actor.org.id);assert.equal(endpoint.url,url);
      assert.equal(endpoint.secret,createdHook.json.secret);assert.match(endpoint.secret,/^whsec_[a-f0-9]{64}$/);
      assert.deepEqual(endpoint.events,['payroll.processed']);webhookCreates++;
      const ownedHook=(row,org)=>{assert.equal(row.organizationId,org);assert.equal(row.url,url);};
      ownedHook(endpoint,actor.org.id);assert.throws(()=>ownedHook(endpoint,victim.org.id),undefined,
        "developer webhook validator accepts another employer's data");mutationDiscriminators++;
      const statsBefore=JSON.parse(readFileSync('outputs/security-write-transport.json','utf8'));
      const deliveriesBefore=await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.organizationId,actor.org.id));
      const tested=requireHttpStatus(await request('/api/developer',{cookie:actor.cookie,
        body:action(actor.org.id,'test-webhook',{endpointId:victimEndpoint.id,userId:victim.owner.id,targetOrganizationId:victim.org.id})}),200,'owned webhook delivery persisted');
      assert.equal(tested.json.attempted,1);assert.equal(tested.json.results[0].endpointId,endpoint.id);
      assert.equal(tested.json.results[0].status,'delivered');webhookTests++;
      const deliveries=await db.select().from(s.webhookDeliveries).where(eq(s.webhookDeliveries.organizationId,actor.org.id));
      assert.equal(deliveries.length,deliveriesBefore.length+1);const delivery=deliveries.at(-1);
      assert.equal(delivery.organizationId,actor.org.id);assert.equal(delivery.endpointId,endpoint.id);
      assert.equal(delivery.status,'delivered');assert.equal(delivery.attempts,1);assert.equal(delivery.responseCode,204);
      assert.equal(delivery.payload.organizationId,actor.org.id);assert.equal(delivery.payload.data.test,true);
      const {signWebhookPayload}=await import('../../src/lib/webhook-signing.ts');
      const stamp=Number(delivery.signature.match(/^t=(\d+),/)?.[1]);
      const p=delivery.payload;
      const wireBody=JSON.stringify({id:p.id,event:p.event,createdAt:p.createdAt,organizationId:p.organizationId,
        data:{test:p.data.test,triggeredBy:p.data.triggeredBy,at:p.data.at}});
      assert.equal(delivery.signature,signWebhookPayload(endpoint.secret,wireBody,stamp));
      const statsAfter=JSON.parse(readFileSync('outputs/security-write-transport.json','utf8'));
      assert.equal(statsAfter.webhooks.length,statsBefore.webhooks.length+1);
      assert.equal(statsAfter.webhooks.at(-1).organizationId,actor.org.id);
      assert.equal(statsAfter.webhooks.at(-1).signatureSha256,hash(delivery.signature));
      assert.equal(statsAfter.webhooks.at(-1).bodySha256,hash(wireBody));
      assert.deepEqual(await snapshotOrganization(victim.org.id),victimBefore,'webhook actions cannot deliver or modify victim');
      for(const [verb,extras] of [['create-key',{name:'audit-veto'}],['revoke-key',{keyId:forged.json.id}],['create-webhook',{url,events:['payroll.processed']}]]){
        const before=await snapshotOrganization(actor.org.id);
        await withSecurityVeto(pool,'audit_events',actor.org.id,async()=>{
          const failed=await request('/api/developer',{cookie:actor.cookie,body:action(actor.org.id,verb,extras)});
          assert.equal(failed.status,500,'actual unhandled audit veto must fail HTTP');
        });
        assert.deepEqual(await snapshotOrganization(actor.org.id),before,'audit veto rolls back '+verb);auditRollbacks++;
      }
    }

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

    // Revocation must be effective at a separate API consumer. A token that
    // once returned a real owned record now denies like a never-minted token,
    // including when a caller supplies a real foreign employer ID.
    const beforeRevokedUse = await snapshotOrganization(actor.org.id);
    const deniedAfterRevoke = requireHttpStatus(await apiEmployeeList(
      created.json.key, "?organizationId=" + victim.org.id,
    ), 401, "revoked key refused at employee API");
    const unknownKey = requireHttpStatus(await apiEmployeeList(
      "sk_live_nonexistent_" + nonce, "?organizationId=" + victim.org.id,
    ), 401, "unissued key refused at employee API");
    assert.deepEqual(deniedAfterRevoke.json, unknownKey.json,
      "previously valid revoked key cannot leak existence through API errors");
    const deniedAlternativeHeader = requireHttpStatus(await apiEmployeeList(
      created.json.key, "?organizationId=" + victim.org.id, true,
    ), 401, "revoked key refused via x-api-key header");
    assert.deepEqual(deniedAlternativeHeader.json, unknownKey.json,
      "both supported token transports must honor key revocation");
    noVictimLeak(deniedAfterRevoke, victim, victimKey);
    noVictimLeak(deniedAlternativeHeader, victim, victimKey);
    assert.deepEqual(await snapshotOrganization(actor.org.id), beforeRevokedUse,
      "revoked and invalid key requests must not update last-used, keys, staff or audits");
    assert.deepEqual(await snapshotOrganization(victim.org.id), victimBefore,
      "revoked key replay with foreign employer selector cannot change or reveal victim data");

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

  const result={
    kind: "TENANT_DEVELOPER_API_KEYS_POST", proof: "fictional-PG16-real-production-HTTP",
    result: "PASS", independentAttackers: 2, ownedCreateAndRevoke: 2,
    realHigherIdVictim: true, foreignExistingAndMissingParity: true,
    bodySelectorForgeryConfinedToOwnEmployer: true, originGate: true,
    actualEmployeeApiOwnDataBeforeRevocation: true,
    foreignEmployerQueryIgnoredForKey: true,
    revokedKeyDeniedAtConsumerViaBothHeaders: true,
    unitScopeAndRevokedMembershipDenied: true, victimSqlAndAuditUnchanged: true,
    webhookDeliveryAttempted: securityWriteRun(),webhookCreates,webhookTests,mutationDiscriminators,auditRollbacks, production: false,
    POST_method_status: "GAP", newCoverageCredits: 0, independentlyApproved: false,
  };
  securityReceipt('developer',result);console.log(JSON.stringify(result));
}

try { await verify(); } finally { await pool.end(); }
