/**
 * Disposable PG16 / actual Next.js HTTP acceptance for statutory remittance
 * action GET+POST, legal-employer ON/OFF parity and escalation recipient grants.
 * Synthetic records only: no real email, payment, filing or production database.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, complianceActionTasks, legalEntities, organizations, outbox,
  payrollRuns, sessions, userLegalEntityGrants, userOrganizations, users,
} from "../../src/db/schema";
import { queueStatutoryComplianceEscalations } from "../../src/lib/statutory-remittance-escalations";
import { statutoryRemittanceTaskEntityId } from "../../src/lib/statutory-remittance-task-scope";

const BASE = process.env.REMITTANCE_ACTION_PROOF_URL;
const ON = process.env.MULTI_ENTITY_ENABLED === "true";
let assertions = 0;
function eqActual(a, b, label) { assert.equal(a, b, label); assertions++; }
function truthy(a, label) { assert.ok(a, label); assertions++; }
function sha(v) { return createHash("sha256").update(v).digest("hex"); }
function isolated() {
  eqActual(process.env.CI, "true", "CI-only");
  eqActual(process.env.GITHUB_ACTIONS, "true", "GitHub Actions-only");
  eqActual(process.env.REMITTANCE_ACTION_PROOF_MODE, "isolated-pg16-only", "Expected isolation mode");
  eqActual(new URL(BASE ?? "").href, "http://127.0.0.1:3019/", "localhost HTTP only");
  eqActual(process.env.APP_BASE_URL, "http://127.0.0.1:3019", "localhost app origin");
  eqActual(new URL(process.env.DATABASE_URL ?? "").href,
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db", "disposable PG16 app_db");
  for (const key of ["RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    truthy(!process.env[key], "No external provider credential: " + key);
  }
  eqActual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false", "PayMongo disbursements disabled");
  eqActual(process.env.XENDIT_PAYOUTS_ENABLED, "false", "Xendit payouts disabled");
}
async function request(path, { cookie, method = "GET", body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (method !== "GET") {
    h.origin = BASE; h["sec-fetch-site"] = "same-origin";
    h["content-type"] = "application/json";
  }
  const response = await fetch(new URL(path, BASE), {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual", cache: "no-store",
  });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* rejected or non-JSON */ }
  return { status: response.status, text, json, headers: response.headers };
}
function expectStatus(r, code, label) {
  eqActual(r.status, code, label + ": " + r.text.slice(0, 200));
  return r;
}
async function actor(org, name, nonce) {
  const [row] = await db.insert(users).values({
    name: "Fictional " + name, email: "remittance-" + name + "-" + nonce + "@example.invalid",
    passwordHash: "test-session-only", role: "owner", totpEnabled: true,
  }).returning({ id: users.id, email: users.email, name: users.name });
  await db.insert(userOrganizations).values({
    userId: row.id, organizationId: org.id, role: "owner", active: true,
  });
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId: row.id, tokenHash: sha(token), expiresAt: new Date(Date.now() + 3600000),
    lastSeenAt: new Date(), mfaVerifiedAt: new Date(), authMethod: "oidc",
  });
  return { ...row, cookie: "__Host-linaw_session=" + token };
}
async function seedTask(org, entity, tag, nonce, number = 0, severity = "info") {
  const [row] = await db.insert(complianceActionTasks).values({
    organizationId: org.id, sourceType: "statutory_remittance",
    sourceKey: entity
      ? "legal-entity:" + entity.id + ":qa:" + nonce + ":" + tag + ":" + number
      : "legacy:qa:" + nonce,
    severity, agency: "SSS", applicableMonth: "2026-09",
    title: "Fictional " + tag + " " + nonce + "-" + number,
    detail: "Synthetic statutory notice for " + tag + " " + nonce,
  }).returning();
  return row;
}
async function snapshot(id) {
  return {
    tasks: await db.select().from(complianceActionTasks)
      .where(eq(complianceActionTasks.organizationId, id)).orderBy(complianceActionTasks.id),
    audits: await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, id)).orderBy(auditEvents.id),
    messages: await db.select().from(outbox)
      .where(eq(outbox.organizationId, id)).orderBy(outbox.id),
    payroll: await db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, id)).orderBy(payrollRuns.id),
  };
}
function noLeak(response, victimTask) {
  truthy(!response.text.includes(victimTask.title), "Victim task title must never appear in denied response");
  truthy(!response.text.includes(victimTask.detail), "Victim task details must never appear in denied response");
  truthy(![...response.headers].some(([key,value]) =>
    (key + value).includes(victimTask.title)), "Victim task must not appear in headers");
}
async function main() {
  isolated();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const [victim, attackerOrgA, attackerOrgB] = await db.insert(organizations).values([
    { name: "Synthetic victim group " + nonce, legalName: "Fictional victim group" },
    { name: "Synthetic attacker A " + nonce, legalName: "Fictional outside A" },
    { name: "Synthetic attacker B " + nonce, legalName: "Fictional outside B" },
  ]).returning({ id: organizations.id });
  const [entityA, entityB, foreignEntityA, foreignEntityB] = await db.insert(legalEntities).values([
    { organizationId: victim.id, code: "OWN", legalName: "Fictional employer A", displayName: "Employer A", primaryEntity: true },
    { organizationId: victim.id, code: "VICTIM", legalName: "Fictional employer B", displayName: "Employer B" },
    { organizationId: attackerOrgA.id, code: "OUTA", legalName: "Fictional unrelated A", displayName: "Outside A", primaryEntity: true },
    { organizationId: attackerOrgB.id, code: "OUTB", legalName: "Fictional unrelated B", displayName: "Outside B", primaryEntity: true },
  ]).returning({ id: legalEntities.id });
  const ownerA = await actor(victim, "owner-a", nonce);
  const ownerB = await actor(victim, "owner-b", nonce);
  const attackerA = await actor(attackerOrgA, "attacker-a", nonce);
  const attackerB = await actor(attackerOrgB, "attacker-b", nonce);
  await db.insert(userLegalEntityGrants).values([
    { organizationId: victim.id, userId: ownerA.id, legalEntityId: entityA.id },
    { organizationId: victim.id, userId: ownerB.id, legalEntityId: entityB.id },
    { organizationId: attackerOrgA.id, userId: attackerA.id, legalEntityId: foreignEntityA.id },
    { organizationId: attackerOrgB.id, userId: attackerB.id, legalEntityId: foreignEntityB.id },
  ]);
  const ownTask = await seedTask(victim, entityA, "OWN", nonce);
  const victimTasks = [];
  for (let i = 0; i < 8; i++)
    victimTasks.push(await seedTask(victim, entityB, "VICTIM", nonce, i, i === 7 ? "danger" : "info"));
  const realVictim = victimTasks[7];
  const legacy = await seedTask(victim, null, "LEGACY", nonce);
  const attackerTaskA = await seedTask(attackerOrgA, foreignEntityA, "ATTA", nonce);
  const attackerTaskB = await seedTask(attackerOrgB, foreignEntityB, "ATTB", nonce);
  truthy(realVictim.id > Math.max(6, ownTask.id), "Real persisted victim task has high ID");
  eqActual(statutoryRemittanceTaskEntityId(realVictim.sourceKey), entityB.id, "Victim task has employer B");
  eqActual(statutoryRemittanceTaskEntityId(legacy.sourceKey), null, "Legacy task has no attribution");

  const ownGet = expectStatus(await request("/api/compliance/remittance-actions?organizationId=" +
    victim.id, { cookie: ownerA.cookie }), 200, "Authenticated owner-A queue GET");
  truthy(ownGet.json?.tasks.some(task => task.id === ownTask.id), "Real own task must be returned");
  if (ON) {
    truthy(!ownGet.json.tasks.some(task => task.id === realVictim.id), "No other employer's task in own queue");
    truthy(!ownGet.json.tasks.some(task => task.id === legacy.id), "Unattributed legacy queue hidden");
    truthy(ownGet.json.assignees.some(user => user.userId === ownerA.id), "Granted assignee shown");
    truthy(!ownGet.json.assignees.some(user => user.userId === ownerB.id), "Ungranted assignee hidden");
  } else {
    truthy(ownGet.json.tasks.some(task => task.id === realVictim.id), "Flag OFF keeps company-wide task list");
    truthy(ownGet.json.tasks.some(task => task.id === legacy.id), "Flag OFF keeps legacy task list");
  }
  const employerBGet = expectStatus(await request("/api/compliance/remittance-actions?organizationId=" +
    victim.id, { cookie: ownerB.cookie }), 200, "Actual employer-B positive GET");
  truthy(employerBGet.json?.tasks.some(task => task.id === realVictim.id), "Employer B's task actually exists");
  for (const [outside, outsideOrg, own] of [
    [attackerA, attackerOrgA, attackerTaskA], [attackerB, attackerOrgB, attackerTaskB],
  ]) {
    const control = expectStatus(await request("/api/compliance/remittance-actions?organizationId=" +
      outsideOrg.id, { cookie: outside.cookie }), 200, "Independent attacker's own GET positive");
    truthy(control.json?.tasks.some(task => task.id === own.id), "Outside actor controls genuine record");
  }

  // Force an actual outbox recipient decision, with no email provider configured.
  const dispatched = await queueStatutoryComplianceEscalations({
    organizationId: victim.id, taskIds: [realVictim.id], actor: "Synthetic CI only",
  });
  if (ON) {
    truthy(dispatched.length === 1 && dispatched[0].recipientUserId === ownerB.id,
      "Only granted employer B owner may receive its escalation");
  } else {
    truthy(dispatched.some(x => x.recipientUserId === ownerA.id) &&
      dispatched.some(x => x.recipientUserId === ownerB.id),
      "Flag OFF preserves old cross-employer operator escalation recipients");
  }
  const notices = (await db.select().from(outbox).where(eq(outbox.organizationId, victim.id)))
    .filter(row => row.purpose === "statutory-remittance-escalation");
  truthy(notices.length > 0 && notices.every(row => row.status === "queued" && row.provider === "none"),
    "Real persisted outbox, no outgoing messages");
  if (ON) truthy(notices.every(row => row.recipient === ownerB.email), "No cross-employer email recipient");
  const [legacyWarning] = await db.update(complianceActionTasks).set({ severity: "warning" })
    .where(eq(complianceActionTasks.id, legacy.id)).returning();
  const legacyNotices = await queueStatutoryComplianceEscalations({
    organizationId: victim.id, taskIds: [legacyWarning.id], actor: "Synthetic CI only",
  });
  if (ON) eqActual(legacyNotices.length, 0, "Unattributed legacy notices suppressed");
  else truthy(legacyNotices.length > 0, "Flag-OFF legacy notices retained");

  const ownPost = expectStatus(await request("/api/compliance/remittance-actions", {
    method: "POST", cookie: ownerA.cookie,
    body: { organizationId: victim.id, action: "acknowledge", taskId: ownTask.id },
  }), 200, "Owned POST acknowledge real task");
  eqActual(ownPost.json?.task?.status, "in_progress", "POST persisted real own state change");
  const victimPositive = expectStatus(await request("/api/compliance/remittance-actions", {
    method: "POST", cookie: ownerB.cookie,
    body: { organizationId: victim.id, action: "acknowledge", taskId: realVictim.id },
  }), 200, "Employer-B's positive high-ID task POST");
  eqActual(victimPositive.json?.task?.id, realVictim.id, "Actual victim task owned successfully");
  const ownedAssignment = expectStatus(await request("/api/compliance/remittance-actions", {
    method: "POST", cookie: ownerA.cookie,
    body: { organizationId: victim.id, action: "assign", taskId: ownTask.id, assignedToUserId: ownerA.id },
  }), 200, "Owner A can assign within granted legal employer");
  eqActual(ownedAssignment.json?.task?.assignedToUserId, ownerA.id, "Granted assignment persisted");
  if (ON) {
    expectStatus(await request("/api/compliance/remittance-actions", {
      method: "POST", cookie: ownerA.cookie,
      body: { organizationId: victim.id, action: "assign", taskId: ownTask.id, assignedToUserId: ownerB.id },
    }), 422, "Cannot assign to owner without employer A grant");
  }

  const before = await snapshot(victim.id);
  for (const attacker of [attackerA, attackerB]) {
    const foreignGet = expectStatus(await request("/api/compliance/remittance-actions?organizationId=" +
      victim.id, { cookie: attacker.cookie }), 403, "Foreign real victim GET denied");
    noLeak(foreignGet, realVictim);
    const foreignPost = expectStatus(await request("/api/compliance/remittance-actions", {
      method: "POST", cookie: attacker.cookie,
      body: { organizationId: victim.id, action: "acknowledge", taskId: realVictim.id },
    }), 403, "Foreign real victim POST denied");
    noLeak(foreignPost, realVictim);
  }
  if (ON) {
    expectStatus(await request("/api/compliance/remittance-actions", {
      method: "POST", cookie: ownerA.cookie,
      body: { organizationId: victim.id, action: "acknowledge", taskId: realVictim.id },
    }), 404, "Same-tenant ungranted employer task hidden by ID");
    expectStatus(await request("/api/compliance/remittance-actions?organizationId=" +
      victim.id + "&legalEntityId=" + entityB.id, { cookie: ownerA.cookie }),
      403, "Forged employer query denied");
    expectStatus(await request("/api/compliance/remittance-actions", {
      method: "POST", cookie: ownerA.cookie,
      headers: { "x-legal-entity-id": String(entityB.id) },
      body: { organizationId: victim.id, action: "assign", taskId: realVictim.id, assignedToUserId: ownerA.id },
    }), 403, "Forged employer header denied");
    expectStatus(await request("/api/compliance/remittance-actions", {
      method: "POST", cookie: ownerA.cookie,
      body: { organizationId: victim.id, action: "acknowledge", taskId: legacy.id },
    }), 404, "Unattributed legacy task denied");
  }
  assert.deepEqual(await snapshot(victim.id), before,
    "Denied real GET/POST/forged employer requests leave victim tasks, audit, outbox and payroll unchanged");
  assertions++;

  const victimTaskBeforeSync = (await db.select().from(complianceActionTasks)
    .where(eq(complianceActionTasks.id, realVictim.id)))[0];
  // Compare only B-employer notifications; A's legitimate sync may create
  // new A-employer alerts and outbox rows without violating tenant isolation.
  const employerBMessages = rows => rows.filter(row =>
    row.recipient === ownerB.email
    || String(row.metadata?.sourceKey ?? "").startsWith("legal-entity:" + entityB.id + ":"));
  const victimOutboxBeforeSync = employerBMessages(await db.select().from(outbox)
    .where(eq(outbox.organizationId, victim.id)).orderBy(outbox.id));
  const ownedSync = expectStatus(await request("/api/compliance/remittance-actions", {
    method: "POST", cookie: ownerA.cookie,
    body: { organizationId: victim.id, action: "sync" },
  }), 200, "Authentic POST sync executes for employer A");
  eqActual(ownedSync.json?.sync?.organizationId, victim.id, "Actual organization sync receipt");
  if (ON) {
    eqActual(ownedSync.json?.sync?.legalEntityId, entityA.id, "Sync scoped to owner A's granted employer");
    assert.deepEqual((await db.select().from(complianceActionTasks)
      .where(eq(complianceActionTasks.id, realVictim.id)))[0], victimTaskBeforeSync,
      "Sync of employer A never resolves or rewrites real employer B task");
    assertions++;
    assert.deepEqual(employerBMessages(await db.select().from(outbox)
      .where(eq(outbox.organizationId, victim.id)).orderBy(outbox.id)), victimOutboxBeforeSync,
      "Sync of employer A must not queue or change employer B notices");
    assertions++;
  } else {
    eqActual(ownedSync.json?.sync?.missingOrganization, false, "Flag OFF all-employer sync preserved");
  }

  await db.delete(userLegalEntityGrants).where(and(
    eq(userLegalEntityGrants.organizationId, victim.id),
    eq(userLegalEntityGrants.userId, ownerB.id),
    eq(userLegalEntityGrants.legalEntityId, entityB.id),
  ));
  if (ON) {
    expectStatus(await request("/api/compliance/remittance-actions?organizationId=" +
      victim.id + "&legalEntityId=" + entityB.id, { cookie: ownerB.cookie }),
      403, "Revoked employer grant rejects previously permitted GET");
    expectStatus(await request("/api/compliance/remittance-actions", {
      method: "POST", cookie: ownerB.cookie,
      headers: { "x-legal-entity-id": String(entityB.id) },
      body: { organizationId: victim.id, action: "sync" },
    }), 403, "Revoked employer grant rejects sync POST");
  } else {
    expectStatus(await request("/api/compliance/remittance-actions?organizationId=" +
      victim.id, { cookie: ownerB.cookie }), 200, "Flag OFF no-grant compatibility");
  }
  console.log(JSON.stringify({
    result: "PASS", kind: "REMITTANCE_ACTION_TENANT_ENTITY_HTTP_PG16",
    multiEntityEnabled: ON, exactMethods: ["GET", "POST"],
    independentOutsideTenants: 2, insideLegalEmployers: 2,
    victimHighId: realVictim.id > 6, immutableDeniedVictim: true,
    notificationGrantsChecked: true, paymentProviderCalls: 0,
    assertions, productionApproval: false,
  }));
}
main().catch(error => {
  console.error("REMITTANCE_ACTION_ENTITY_HTTP_FAILED",
    error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
