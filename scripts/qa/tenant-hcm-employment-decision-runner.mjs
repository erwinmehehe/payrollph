/**
 * #1558: UNACCEPTED, ZERO-CREDIT HCM decision POST tenant isolation.
 * Independent fictional victim + two attacker tenants, actual localhost
 * production-mode HTTP and strictly disposable GitHub Actions PostgreSQL 16.
 *
 * Deliberately separate from tenant-second-pass-http.mjs: that runner's
 * existing COVERED method proofs are source-hash/line pinned to prior CI
 * receipts. Never mutate it or repin prior acceptance to claim this work.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  HCM_DECISION_POST, requireDisposableHcmDecisionEnv,
} from "./tenant-hcm-employment-decision-contract.mjs";

// Static imports execute before the first statement in this file. Refuse an
// unsafe target BEFORE importing any application module that initializes DB.
requireDisposableHcmDecisionEnv(); // before any DB module import
const [{ db, pool }, schema, { verifyHcmEmploymentDecisionPost }] = await Promise.all([
  import("../../src/db/index.ts"),
  import("../../src/db/schema.ts"),
  import("./tenant-hcm-employment-decision-post.mjs"),
]);
const {
  legalEntities, orgUnits, organizations, payrollRuns,
  sessions, userOrganizations, users,
} = schema;

const ORIGIN = "http://127.0.0.1:3000";

async function makeFixture() {
  requireDisposableHcmDecisionEnv();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const orgs = await db.insert(organizations).values(
    ["Victim", "AttackerA", "AttackerB"].map((label) => ({
      name: "Fictional HCM " + label + " " + nonce,
      legalName: "Synthetic proof " + label + " " + nonce,
    })),
  ).returning({ id: organizations.id });
  assert.equal(orgs.length, 3);
  assert.equal(new Set(orgs.map((row) => row.id)).size, 3);

  const owners = await db.insert(users).values(orgs.map((_, index) => ({
    email: "hcm-post-proof-" + index + "-" + nonce + "@example.invalid",
    name: "Fictional HCM Owner " + index,
    passwordHash: "non-login-ci-fixture-only",
    localPasswordEnabled: false,
    role: "owner",
  }))).returning({ id: users.id, name: users.name });
  assert.equal(owners.length, 3);
  await db.insert(userOrganizations).values(orgs.map((org, index) => ({
    userId: owners[index].id, organizationId: org.id, role: "owner",
    active: true,
  })));

  const entities = await db.insert(legalEntities).values(orgs.map((org, index) => ({
    organizationId: org.id,
    code: "HCM-" + nonce + "-" + index,
    legalName: "Synthetic HCM Legal Employer " + index,
    displayName: "Fictional HCM Entity " + index,
    primaryEntity: true,
  }))).returning({ id: legalEntities.id });
  const ownedUnits = await db.insert(orgUnits).values(orgs.map((org, index) => ({
    organizationId: org.id,
    legalEntityId: entities[index].id,
    type: "department",
    code: "HCM-" + nonce + "-" + index,
    name: "Fictional HCM unit " + index,
  }))).returning({ id: orgUnits.id });
  assert.equal(entities.length, 3);
  assert.equal(ownedUnits.length, 3);

  // A nonempty victim payroll snapshot rejects false passes that compare only
  // empty arrays after a denied POST. No payroll is calculated or released.
  const runs = await db.insert(payrollRuns).values(orgs.map((org, index) => ({
    organizationId: org.id, legalEntityId: entities[index].id,
    periodLabel: "Fictional HCM no-money " + nonce + "-" + index,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
    payDate: "2026-10-16",
    status: "Draft",
    grossPay: "0.00", netPay: "0.00",
  }))).returning({ id: payrollRuns.id, organizationId: payrollRuns.organizationId });
  assert.equal(runs.length, 3);
  assert.ok(runs.every((run, index) => run.organizationId === orgs[index].id));
  return { orgs, owners, entities, ownedUnits };
}

async function makeSession(userId, { privileged = false } = {}) {
  requireDisposableHcmDecisionEnv();
  assert.ok(Number.isSafeInteger(userId) && userId > 0);
  const token = randomBytes(32).toString("hex");
  const [session] = await db.insert(sessions).values({
    userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60_000),
    lastSeenAt: new Date(),
    ...(privileged ? { mfaVerifiedAt: new Date(), authMethod: "oidc" } : {}),
  }).returning({ id: sessions.id });
  assert.ok(Number.isSafeInteger(session?.id) && session.id > 0);
  // npm start runs Next.js in production mode, requiring the __Host cookie.
  return { id: session.id, cookie: "__Host-linaw_session=" + token };
}

async function request(path, { method = "GET", cookie, body } = {}) {
  requireDisposableHcmDecisionEnv();
  assert.equal(path, HCM_DECISION_POST, "Only the uncredited HCM POST route is permitted");
  assert.equal(method, "POST", "This candidate must actually exercise HTTP POST");
  const url = new URL(path, ORIGIN);
  assert.equal(url.origin, ORIGIN);
  assert.ok(cookie?.startsWith("__Host-linaw_session="));
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      Origin: ORIGIN,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json };
}

function expectStatus(response, expected, label) {
  assert.equal(response.status, expected,
    label + " returned HTTP " + response.status);
  return response;
}

try {
  requireDisposableHcmDecisionEnv();
  const fixtures = await makeFixture();
  await verifyHcmEmploymentDecisionPost(fixtures, { request, expectStatus, makeSession });
} catch (error) {
  console.error("HCM_POST_TENANT_CANDIDATE_FAILED (no credit):",
    error instanceof Error ? error.message.slice(0, 400) : "unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
