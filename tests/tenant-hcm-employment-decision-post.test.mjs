import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  HCM_DECISION_POST, requireDisposableHcmDecisionEnv,
  assertVictimDecisionUnchanged, assertNoVictimDecisionLeak,
  assertDeniedHcmDecisionResponse,
} from "../scripts/qa/tenant-hcm-employment-decision-contract.mjs";

const source = readFileSync("scripts/qa/tenant-hcm-employment-decision-post.mjs", "utf8");
const sharedRunner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const isolatedRunner = readFileSync("scripts/qa/tenant-hcm-employment-decision-runner.mjs", "utf8");
const workflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
const route = readFileSync("src/app/api/hcm/employment-term-decisions/route.ts", "utf8");

const safeEnv = {
  CI: "true", GITHUB_ACTIONS: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  REQUIRE_PRIVILEGED_MFA: "true", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
};

test("HCM POST proof refuses every non-disposable execution target and live provider key", () => {
  assert.doesNotThrow(() => requireDisposableHcmDecisionEnv(safeEnv));
  const substitutions = [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["TENANT_SECOND_PASS_MODE", "dev"], ["REQUIRE_PRIVILEGED_MFA", "false"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["DATABASE_URL", "postgresql://postgres:postgres@database.internal:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/production"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db?host=remote.invalid"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db#unexpected"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "live-provider-key"],
  ];
  for (const [key, value] of substitutions) {
    assert.throws(() => requireDisposableHcmDecisionEnv({ ...safeEnv, [key]: value }),
      undefined, "Unexpected acceptance for " + key);
  }
});

test("victim snapshot and confidentiality negative-controls fail loudly", () => {
  const before = { decisions: [{ id: 71, reason: "VICTIM" }], auditEvents: [{ id: 99 }] };
  assert.doesNotThrow(() => assertVictimDecisionUnchanged(before, structuredClone(before), "valid"));
  assert.throws(() => assertVictimDecisionUnchanged(before, {
    ...before, decisions: [{ id: 71, reason: "CORRUPTED" }],
  }, "victim changed"));
  assert.doesNotThrow(() => assertNoVictimDecisionLeak({ text: '{"ok":true}' }, "VICTIM", "safe"));
  assert.throws(() => assertNoVictimDecisionLeak({ text: "VICTIM" }, "VICTIM", "leak"));
  const safeDenial = { text: '{"error":"Access denied"}', json: { error: "Access denied" } };
  assert.doesNotThrow(() => assertDeniedHcmDecisionResponse(safeDenial, "VICTIM", "denied"));
  for (const invalid of [
    { text: "<html>Forbidden</html>", json: null },
    { text: '{"decision":{"id":41}}', json: { error: "Access denied", decision: { id: 41 } } },
    { text: '{"error":"VICTIM"}', json: { error: "VICTIM" } },
  ]) assert.throws(() => assertDeniedHcmDecisionResponse(invalid, "VICTIM", "unsafe denial"));
});

test("actual production HCM POST tenant and MFA guards remain scoped", () => {
  assert.equal(HCM_DECISION_POST, "/api/hcm/employment-term-decisions");
  for (const guard of [
    "const originDenied = enforceSameOriginMutation(request);",
    "const gate = await assertDecisionAdmin(user.id, organizationId);",
    "const mfaDenied = requireSensitiveActionMfa(user);",
    "eq(employees.organizationId, organizationId)",
    "eq(hcmEmploymentTerms.organizationId, organizationId)",
    "eq(hcmEmploymentTerms.employeeId, employeeId)",
    "await tx.insert(hcmEmploymentTermDecisions).values({",
    "await tx.insert(hcmEmploymentDecisionEvents).values({",
    "await tx.insert(auditEvents).values({",
  ]) assert.ok(route.includes(guard), "HCM source guard missing: " + guard);
});

test("two real owned HTTP inserts and high-ID victim/forged SQL denial are executed in PG16 suite", () => {
  // The historic second-pass runner is receipt-pinned by other COVERED methods.
  // This provisional HCM case must run separately and never repin those receipts.
  assert.doesNotMatch(sharedRunner, /verifyHcmEmploymentDecisionPost/);
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-hcm-employment-decision-runner\.mjs/);
  assert.match(workflow, /node --check scripts\/qa\/tenant-hcm-employment-decision-runner\.mjs/);
  assert.match(workflow, /image: postgres:16/);
  assert.match(isolatedRunner, /await verifyHcmEmploymentDecisionPost\(fixtures, \{ request, expectStatus, makeSession \}\)/);
  for (const assertion of [
    'requireDisposableHcmDecisionEnv();',
    'await db.insert(organizations).values(',
    'await db.insert(userOrganizations).values(',
    'await db.insert(legalEntities).values(',
    'await db.insert(orgUnits).values(',
    'await db.insert(payrollRuns).values(',
    'await db.insert(sessions).values({',
    'mfaVerifiedAt: new Date(), authMethod: "oidc"',
    'cookie: "__Host-linaw_session=" + token',
    'const response = await fetch(url, {',
    'assert.equal(method, "POST"',
    'return { status: response.status, text, json };',
    'await pool.end();',
  ]) assert.ok(isolatedRunner.includes(assertion),
    "Independent fictional PG16 HCM HTTP runner safeguard missing: " + assertion);
  for (const guard of [
    "requireDisposableHcmDecisionEnv();",
    "makeSession(f.owners[index].id, { privileged: true })",
    "assert.ok(victimTerm.id > Math.max(terms[0].id, terms[1].id, 6))",
    "assert.ok(victimDecisions.at(-1).id > 6",
    "for (const index of [0, 1])",
    "const owned = expectStatus(await request(HCM_DECISION_POST, {",
    "}), 201,",
    "status: 403, type: \"victim-organization\"",
    "status: 404, type: \"victim-employee-and-term\"",
    "status: 404, type: \"victim-term-under-own-employee\"",
    "status: 404, type: \"victim-employee-under-own-term\"",
    "assertVictimDecisionUnchanged(victimBefore, await tenantSnapshot(victim.id)",
    "assert.deepEqual(afterOwn.payrollRuns, beforeOwn.payrollRuns",
    "newCredits: 0, independentlyAccepted: false, productionCertified: false",
    "assertDeniedHcmDecisionResponse(denied, victimMarker, attack.type)",
    "db.update(userOrganizations).set({ active: false })",
    '}), 403, "Revoked fictional owner must not create an employment decision"',
    "assertVictimDecisionUnchanged(victimBefore, await tenantSnapshot(victim.id)",
    "db.update(userOrganizations).set({ active: true })",
    "assert.equal(revokedDenials, 2)",
    "revokedOwnerHttp403: revokedDenials",
  ]) assert.ok(source.includes(guard), "Proof safeguard missing: " + guard);
});

test("source-only candidate cannot falsely promote HCM POST from GAP to COVERED", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const row = manifest.allApiRouteFiles["src/app/api/hcm/employment-term-decisions/route.ts"];
  const method = row?.methods.find(item => item.name === "POST");
  assert.equal(method?.status, "GAP");
  assert.equal(method?.testedBy, null);
});
