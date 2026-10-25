import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { chromium } from "playwright";

/**
 * MNY-01 payout-change GET/PATCH: real authenticated HTTPS through Next.js,
 * multi-entity ON and OFF, with three separate organizations and two legal
 * employers inside the victim organization. Disposable PG16 only, fictional
 * mobile numbers, no real account, payout, provider or external side effect.
 */
export const PAYOUT_ENTITY_METHODS = Object.freeze([
  "GET payout-destination-changes",
  "PATCH payout-destination-changes/[id]",
]);
const ON = "https://127.0.0.1:3000";
const OFF = "https://127.0.0.1:3001";
const PASSWORD = "Synthetic-Entity-QA-2026-Only!";

function requireDisposable() {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
  assert.equal(process.env.MULTI_ENTITY_ENABLED, "true");
  assert.equal(process.env.DATABASE_URL,
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
}
requireDisposable();

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
const browser = await chromium.launch({ headless: true });
const contexts = [];
const orgIds = [], userIds = [];
let assertions = 0;
async function one(statement, args) {
  const result = await sql.query(statement, args);
  assert.equal(result.rows.length, 1, "Synthetic fixture expected exactly one row");
  return result.rows[0];
}
function check(condition, label) { assert.ok(condition, label); assertions++; }
function expectStatus(result, code, label) {
  assert.equal(result.status, code, label + ": HTTP " + result.status
    + " " + JSON.stringify(result.data).slice(0, 250));
  assertions++;
  return result;
}
async function signedIn(user, base) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  contexts.push(context);
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin",
      "x-forwarded-for": user.loginIp },
    data: { email: user.email, password: PASSWORD },
    failOnStatusCode: false,
  });
  assert.equal(login.status(), 200, "Actual password login is required for " + user.label);
  const session = (await context.cookies(base)).find(c => c.name === "__Host-linaw_session");
  check(session?.secure && session.httpOnly, "Signed-in production session has Secure HttpOnly cookie");
  return context;
}
async function request(context, base, path, method = "GET", body, headers = {}) {
  const response = await context.request.fetch(base + path, {
    method, headers: { ...headers,
      ...(method === "GET" ? {} : {
        "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin",
      }),
    }, data: body, failOnStatusCode: false, maxRedirects: 0,
  });
  const text = await response.text();
  check(!text.includes("000000000001") && !text.includes("000000000002"),
    "Never disclose full fictional bank account values");
  return { status: response.status(), data: JSON.parse(text || "null"), text };
}
async function tenant(label) {
  const org = await one("INSERT INTO organizations(name,legal_name) VALUES($1,$2) RETURNING id",
    ["PAYOUT ENTITY " + label, "Fictional Legal " + label]);
  orgIds.push(org.id);
  await sql.query("INSERT INTO treasury_control_policies(organization_id,enabled,enabled_at) VALUES($1,true,now())",
    [org.id]);
  return org.id;
}
async function employer(orgId, code, primary) {
  const row = await one(`INSERT INTO legal_entities
    (organization_id,code,legal_name,display_name,primary_entity)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [orgId, code, "Fictional " + code, code, primary]);
  return row.id;
}
async function actor(label, orgId, entityId, role, passwordHash, index) {
  const email = "payout-entity-" + label + "-" + nonce + "@example.invalid";
  const u = await one(`INSERT INTO users(email,name,role,password_hash)
    VALUES($1,$2,$3,$4) RETURNING id`,
    [email, "Synthetic " + label, role, passwordHash]);
  userIds.push(u.id);
  await sql.query(`INSERT INTO user_organizations(user_id,organization_id,role,active)
    VALUES($1,$2,$3,true)`, [u.id, orgId, role]);
  await sql.query(`INSERT INTO user_legal_entity_grants(user_id,organization_id,legal_entity_id)
    VALUES($1,$2,$3)`, [u.id, orgId, entityId]);
  if (label.endsWith("checker")) {
    await sql.query(`INSERT INTO treasury_operator_assignments(organization_id,user_id,active)
      VALUES($1,$2,true)`, [orgId, u.id]);
  }
  return { id: u.id, email, label, loginIp: "198.51.100." + (100 + index) };
}
async function seedRequest(orgId, entityId, maker, marker, mobile = "09998887777", frozen = true) {
  const worker = await one(`INSERT INTO employees(
    organization_id,legal_entity_id,employee_no,first_name,last_name,title,
    avatar_initials,basic_rate,start_date
    ) VALUES($1,$2,$3,$4,'Synthetic','Staff','FS','35000','2026-01-01')
    RETURNING id,organization_id,legal_entity_id`,
    [orgId, entityId, marker.slice(0, 32), marker]);
  const original = { maskedAccount: null, bankCode: null, mobile: null };
  if (frozen) original.legalEntityId = entityId;
  const sha = createHash("sha256").update(JSON.stringify({
    bankAccount: null, bankCode: null, mobile: null,
  })).digest("hex");
  const evidence = await one(`INSERT INTO employee_payout_change_requests(
    organization_id,employee_id,status,reason,original_snapshot,
    original_state_sha256,proposed_mobile,requested_by_user_id,requested_by_name
    ) VALUES($1,$2,'pending',$3,$4::jsonb,$5,$6,$7,$8)
    RETURNING id,employee_id,organization_id`,
    [orgId, worker.id, marker, JSON.stringify(original), sha, mobile, maker.id, "Synthetic maker"]);
  return { worker, evidence, marker };
}
async function snapshot(orgId) {
  const [employees, requests, audit] = await Promise.all([
    sql.query("SELECT to_jsonb(e) AS row FROM employees e WHERE organization_id=$1 ORDER BY id", [orgId]),
    sql.query(`SELECT to_jsonb(r) AS row FROM employee_payout_change_requests r
      WHERE organization_id=$1 ORDER BY id`, [orgId]),
    sql.query("SELECT to_jsonb(a) AS row FROM audit_events a WHERE organization_id=$1 ORDER BY id", [orgId]),
  ]);
  return { employees: employees.rows, requests: requests.rows, audit: audit.rows };
}
function ownRequests(response, included, excluded, label) {
  expectStatus(response, 200, label);
  const rows = response.data?.requests;
  check(Array.isArray(rows) && rows.some(row => row.id === included),
    label + ": owned payout request must be in a nonempty response");
  for (const id of excluded) {
    check(!rows.some(row => row.id === id), label + ": foreign request ID must not be returned");
  }
  return rows;
}
async function deniedAndUnchanged(context, base, path, method, body, expected, victimOrg, label, headers) {
  const before = await snapshot(victimOrg);
  const denied = expectStatus(await request(context, base, path, method, body, headers), expected, label);
  check(!denied.text.includes("VICTIM-ALPHA") && !denied.text.includes("VICTIM-BETA"),
    label + ": victim reason must never appear in response");
  const after = await snapshot(victimOrg);
  assert.deepEqual(after, before, label + ": real victim employee, payout and audit rows unchanged");
  assertions++;
  return denied;
}

const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
try {
  await sql.connect();
  const originalUser = await one("SELECT password_hash FROM users WHERE email=$1",
    ["entity-owner@example.test"]);
  const attackerB = await tenant("ATTACKER-B-" + nonce);
  const attackerC = await tenant("ATTACKER-C-" + nonce);
  const victimA = await tenant("VICTIM-A-" + nonce);
  const bEntity = await employer(attackerB, "PAYOUT-B-" + nonce, true);
  const cEntity = await employer(attackerC, "PAYOUT-C-" + nonce, true);
  const alpha = await employer(victimA, "PAYOUT-ALPHA-" + nonce, true);
  const beta = await employer(victimA, "PAYOUT-BETA-" + nonce, false);
  const makers = {
    b: await actor("b-maker", attackerB, bEntity, "owner", originalUser.password_hash, 1),
    c: await actor("c-maker", attackerC, cEntity, "owner", originalUser.password_hash, 2),
    a: await actor("a-maker", victimA, alpha, "owner", originalUser.password_hash, 3),
  };
  const checkers = {
    b: await actor("b-checker", attackerB, bEntity, "owner", originalUser.password_hash, 4),
    c: await actor("c-checker", attackerC, cEntity, "owner", originalUser.password_hash, 5),
    alpha: await actor("alpha-checker", victimA, alpha, "owner", originalUser.password_hash, 6),
    beta: await actor("beta-checker", victimA, beta, "admin", originalUser.password_hash, 7),
  };

  // Attackers own genuine fixture requests BEFORE the victim is created.
  const bRows = [], cRows = [];
  for (let i = 0; i < 4; i++) {
    bRows.push(await seedRequest(attackerB, bEntity, makers.b, "OWN-B-" + nonce + "-" + i));
    cRows.push(await seedRequest(attackerC, cEntity, makers.c, "OWN-C-" + nonce + "-" + i));
  }
  const aAlpha = await seedRequest(victimA, alpha, makers.a, "VICTIM-ALPHA-" + nonce);
  const aBeta = await seedRequest(victimA, beta, makers.a, "VICTIM-BETA-" + nonce);
  const transferred = await seedRequest(victimA, alpha, makers.a, "VICTIM-TRANSFER-" + nonce);
  const legacy = await seedRequest(victimA, alpha, makers.a, "VICTIM-LEGACY-" + nonce, "09996665555", false);
  const remaining = await seedRequest(victimA, alpha, makers.a, "VICTIM-REVOKE-" + nonce);
  check(aAlpha.evidence.id > 6 && aAlpha.evidence.id > bRows.at(-1).evidence.id
    && aAlpha.evidence.id > cRows.at(-1).evidence.id,
    "Victim-only payout ID is a real PostgreSQL row greater than both attackers' IDs");

  const b = await signedIn(checkers.b, ON), c = await signedIn(checkers.c, ON);
  const pa = await signedIn(checkers.alpha, ON), pb = await signedIn(checkers.beta, ON);
  const ownB = "/api/payout-destination-changes?organizationId=" + attackerB;
  const ownC = "/api/payout-destination-changes?organizationId=" + attackerC;
  const victimList = "/api/payout-destination-changes?organizationId=" + victimA;
  const patch = id => "/api/payout-destination-changes/" + id;
  const decision = (orgId, legalEntityId) => ({
    organizationId: orgId, legalEntityId, decision: "approve",
  });
  const victimIds = [aAlpha, aBeta, transferred, legacy, remaining].map(x => x.evidence.id);
  // GET: independent B and C get populated own data, neither sees actual A.
  const getB = ownRequests(await request(b, ON, ownB), bRows[0].evidence.id, victimIds, "B owned GET 200");
  const getC = ownRequests(await request(c, ON, ownC), cRows[0].evidence.id, victimIds, "C owned GET 200");
  check(getB.length === 4 && getC.length === 4, "Both independent attackers see all four owned requests");
  const victimBefore = await snapshot(victimA);
  for (const [actor, own, orgId, entity, item] of [
    [b, ownB, attackerB, bEntity, bRows[0]],
    [c, ownC, attackerC, cEntity, cRows[0]],
  ]) {
    await deniedAndUnchanged(actor, ON, victimList, "GET", undefined, 403, victimA,
      "Foreign organization GET denies tenant A");
    await deniedAndUnchanged(actor, ON, own + "&employeeId=" + aAlpha.worker.id,
      "GET", undefined, 404, victimA, "Forged victim employee selector denied");
    await deniedAndUnchanged(actor, ON, own, "GET", undefined, 403, victimA,
      "Forged employer header denied", { "x-legal-entity-id": String(alpha) });
    await deniedAndUnchanged(actor, ON, patch(aAlpha.evidence.id),
      "PATCH", decision(orgId, entity), 404, victimA, "Real foreign request ID denied");
    await deniedAndUnchanged(actor, ON, patch(aAlpha.evidence.id),
      "PATCH", decision(victimA, alpha), 403, victimA, "Forged victim organization denied");
    await deniedAndUnchanged(actor, ON, patch(item.evidence.id),
      "PATCH", decision(orgId, alpha), 403, victimA, "Forged legalEntityId body denied");
  }
  assert.deepEqual(await snapshot(victimA), victimBefore,
    "All B/C cross-tenant requests preserve victim A's real rows");
  assertions++;

  // The same exact PATCH method has an owned success for BOTH independent attackers.
  const positivePatchB = expectStatus(await request(b, ON, patch(bRows[0].evidence.id),
    "PATCH", decision(attackerB, bEntity)), 200, "B owned PATCH 200");
  check(positivePatchB.data?.decision === "approved", "B approves only its own request");
  const positivePatchC = expectStatus(await request(c, ON, patch(cRows[0].evidence.id),
    "PATCH", decision(attackerC, cEntity)), 200, "C owned PATCH 200");
  check(positivePatchC.data?.decision === "approved", "C approves only its own request");
  assert.deepEqual(await snapshot(victimA), victimBefore,
    "Both legitimate attacker approvals leave foreign victim database unchanged");
  assertions++;

  // In one tenant, a company-wide owner still has exactly ONE selected employer.
  ownRequests(await request(pa, ON, victimList), aAlpha.evidence.id,
    [aBeta.evidence.id, legacy.evidence.id], "Alpha employer GET 200");
  ownRequests(await request(pb, ON, victimList), aBeta.evidence.id,
    [aAlpha.evidence.id, legacy.evidence.id], "Beta employer GET 200");
  await deniedAndUnchanged(pa, ON, victimList + "&employeeId=" + aBeta.worker.id,
    "GET", undefined, 403, victimA, "Same-tenant foreign employee denied");
  await deniedAndUnchanged(pa, ON, victimList, "GET", undefined, 403, victimA,
    "Other legal employer header cannot override grant", { "x-legal-entity-id": String(beta) });
  await deniedAndUnchanged(pa, ON, patch(aBeta.evidence.id),
    "PATCH", decision(victimA, alpha), 403, victimA,
    "Same-tenant foreign payout request denied");
  await deniedAndUnchanged(pa, ON, patch(aAlpha.evidence.id),
    "PATCH", decision(victimA, beta), 403, victimA,
    "Same-tenant forged body employer denied");

  const sameTenantAlpha = expectStatus(await request(pa, ON, patch(aAlpha.evidence.id),
    "PATCH", decision(victimA, alpha)), 200, "Alpha independent checker own PATCH");
  check(sameTenantAlpha.data?.decision === "approved", "Alpha own approval recorded");
  const sameTenantBeta = expectStatus(await request(pb, ON, patch(aBeta.evidence.id),
    "PATCH", decision(victimA, beta)), 200, "Beta independent checker own PATCH");
  check(sameTenantBeta.data?.decision === "approved", "Beta own approval recorded");

  // A pending request cannot follow the person into another legal employer.
  await sql.query("UPDATE employees SET legal_entity_id=$1 WHERE id=$2 AND organization_id=$3",
    [beta, transferred.worker.id, victimA]);
  const afterTransfer = await snapshot(victimA);
  const alphaRead = ownRequests(await request(pa, ON, victimList), remaining.evidence.id,
    [transferred.evidence.id], "Transferred request absent from old employer list");
  const betaRead = ownRequests(await request(pb, ON, victimList), aBeta.evidence.id,
    [transferred.evidence.id], "Transferred request absent from new employer list");
  check(alphaRead.every(x => x.id !== legacy.evidence.id)
    && betaRead.every(x => x.id !== legacy.evidence.id), "Legacy unfrozen request remains hidden");
  await deniedAndUnchanged(pa, ON, patch(transferred.evidence.id),
    "PATCH", decision(victimA, alpha), 403, victimA, "Transferred worker blocks old employer");
  await deniedAndUnchanged(pb, ON, patch(transferred.evidence.id),
    "PATCH", decision(victimA, beta), 403, victimA, "Frozen origin blocks new employer");
  await deniedAndUnchanged(pa, ON, patch(legacy.evidence.id),
    "PATCH", decision(victimA, alpha), 403, victimA, "Unattributed legacy request fails closed");
  assert.deepEqual(await snapshot(victimA), afterTransfer,
    "Legacy and transferred payout requests remain pending and unchanged");
  assertions++;

  // Access revocation is effective without logging the same account out.
  await sql.query(`DELETE FROM user_legal_entity_grants
    WHERE organization_id=$1 AND user_id=$2 AND legal_entity_id=$3`,
    [victimA, checkers.alpha.id, alpha]);
  await deniedAndUnchanged(pa, ON, victimList, "GET", undefined, 403, victimA,
    "Revoked employer grant denies same signed-in session GET");
  await deniedAndUnchanged(pa, ON, patch(remaining.evidence.id),
    "PATCH", decision(victimA, alpha), 403, victimA,
    "Revoked grant denies previously eligible PATCH");

  // OFF mode preserves existing company-wide read behavior; no production flags change.
  const offAlpha = await signedIn(checkers.alpha, OFF);
  const legacyOff = ownRequests(await request(offAlpha, OFF, victimList), legacy.evidence.id,
    [], "Flag-OFF legacy read compatibility");
  check(legacyOff.some(x => x.id === transferred.evidence.id),
    "Flag-OFF organizational visibility is unchanged");

  console.log(JSON.stringify({ result: "PASS", methods: PAYOUT_ENTITY_METHODS,
    independentAttackers: 2, separateOrganizations: 3, sameTenantLegalEmployers: 2,
    authenticatedHttps: true, disposablePostgres: true, assertions,
    realPayout: false, productionApproved: false }));
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {});
  await browser.close();
  try {
    if (orgIds.length) await sql.query("DELETE FROM organizations WHERE id=ANY($1::integer[])", [orgIds]);
    if (userIds.length) await sql.query("DELETE FROM users WHERE id=ANY($1::integer[])", [userIds]);
  } finally {
    await sql.end().catch(() => {});
  }
}
