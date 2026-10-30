import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PII_APPROVAL_ROUTE, requireDisposablePiiApprovalEnv,
  assertNoPiiLeak, assertVictimPiiUnchanged,
} from "../scripts/qa/tenant-pii01-approval-contract.mjs";

const runner = readFileSync("scripts/qa/tenant-pii01-approval-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
const historical = readFileSync("scripts/qa/tenant-pii01-identifier-review-http.mjs", "utf8");
const shared = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const route = readFileSync("src/app/api/employee-identifier-requests/route.ts", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const safe = {
  CI: "true", GITHUB_ACTIONS: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  REQUIRE_PRIVILEGED_MFA: "true", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  NODE_ENV: "production", DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  PII_ENCRYPTION_KEY: "1".repeat(64),
};

test("approval fixture refuses all non-CI targets, inherited live keys and omitted safety switches", () => {
  assert.doesNotThrow(() => requireDisposablePiiApprovalEnv(safe));
  const unsafe = [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"], ["TENANT_SECOND_PASS_MODE", "local"],
    ["REQUIRE_PRIVILEGED_MFA", "false"], ["SECURITY_SMOKE_URL", "https://production.example"],
    ["DATABASE_URL", "postgresql://postgres:postgres@remote.invalid:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/production"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db?host=remote.invalid"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db#evil"],
    ["DATABASE_URL", "postgresql://postgres:wrong@127.0.0.1:5432/app_db"],
    ["NODE_ENV", "development"], ["DEMO_MODE", "true"], ["WORKER_ENABLED", "true"],
    ["CENTRAL_SCHEDULER_ENABLED", "true"], ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"], ["XENDIT_BILLING_ENABLED", "true"],
    ["PII_ENCRYPTION_KEY", "bad-key"], ["PII_ENCRYPTION_KEY_PREVIOUS", "stale-key"],
    ["PAYMONGO_SECRET_KEY", "fake-live-key"], ["XENDIT_SECRET_KEY", "fake-live-key"],
    ["POSTMARK_SERVER_TOKEN", "fake-live-key"], ["SMTP_URL", "smtp://remote.invalid"],
  ];
  for (const [key, value] of unsafe) assert.throws(() =>
    requireDisposablePiiApprovalEnv({ ...safe, [key]: value }),
    undefined, "Unsafe environment allowed: " + key);
  for (const key of [
    "CI", "GITHUB_ACTIONS", "TENANT_SECOND_PASS_MODE", "REQUIRE_PRIVILEGED_MFA",
    "SECURITY_SMOKE_URL", "DATABASE_URL", "NODE_ENV", "DEMO_MODE",
    "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED",
    "XENDIT_PAYOUTS_ENABLED", "XENDIT_BILLING_ENABLED", "PII_ENCRYPTION_KEY",
  ]) assert.throws(() => requireDisposablePiiApprovalEnv({ ...safe, [key]: undefined }),
    undefined, "Missing safety control allowed: " + key);
});

test("adversarial victim SQL and response-disclosure assertions fail on tampering", () => {
  const before = { staff: [{ id: 99 }], requests: [{ id: 100 }], optional: [{ id: 1 }],
    audit: [{ id: 32 }], payroll: [{ id: 43 }] };
  assert.doesNotThrow(() => assertVictimPiiUnchanged(before, structuredClone(before), "clean"));
  assert.throws(() => assertVictimPiiUnchanged(before, {
    ...before, optional: [{ id: 1, encryptedValue: "CHANGED" }],
  }, "modified"));
  const headers = new Headers({ "cache-control": "private, no-store" });
  assert.doesNotThrow(() => assertNoPiiLeak({
    text: '{"error":"Access denied"}', headers,
  }, "VICTIM-MARKER", ["sealed-victim-id"], "clean"));
  assert.throws(() => assertNoPiiLeak({
    text: "VICTIM-MARKER", headers,
  }, "VICTIM-MARKER", [], "leak"));
  assert.throws(() => assertNoPiiLeak({
    text: "sealed-victim-id", headers,
  }, "VICTIM-MARKER", ["sealed-victim-id"], "leak"));
  assert.throws(() => assertNoPiiLeak({
    text: "{}", headers: new Headers({ "cache-control": "public, max-age=120" }),
  }, "VICTIM-MARKER", [], "public response"));
});

test("independent real-HTTP approval runner loads DB only after the strict disposable check", () => {
  assert.equal(PII_APPROVAL_ROUTE, "/api/employee-identifier-requests");
  assert.doesNotMatch(runner, /from\s+["']\.\.\/\.\.\/src\/db/);
  const gate = runner.indexOf("requireDisposablePiiApprovalEnv();");
  const dbImport = runner.indexOf('import("../../src/db/index.ts")');
  assert.ok(gate >= 0 && dbImport > gate);
  for (const guard of [
    "const ORIGIN = \"http://127.0.0.1:3000\"",
    "cookie: \"__Host-linaw_session=\" + token",
    "mfaVerifiedAt: new Date()",
    "authMethod: \"oidc\"",
    "await db.insert(organizations).values(",
    "await db.insert(userOrganizations).values(",
    "await db.insert(employees).values(",
    "await db.insert(essIdentifierRequests).values(",
    "await db.insert(essOtherIdentifiers).values(",
    "await db.insert(auditEvents).values({",
    "await db.insert(payrollRuns).values(",
    "const response = await fetch(ORIGIN + PII_APPROVAL_ROUTE, {",
    "redirect: \"manual\"",
    "signal: AbortSignal.timeout(45_000)",
    "await pool.end();",
  ]) assert.ok(runner.includes(guard), "Missing real PG16 or HTTP safeguard: " + guard);
});

test("success and denials exercise every core field and both optional upsert modes", () => {
  for (const key of [
    "sssNo", "tin", "tinBranchCode", "philHealthNo", "pagIbigNo",
    "passportNo", "driversLicenseNo", "prcLicenseNo", "umidNo",
  ]) assert.ok(runner.includes('kind: "' + key + '"'), "Missing ID kind: " + key);
  for (const guard of [
    "const POSITIVE = SPECS.filter",
    "for (const a of f.attackers)",
    "for (const spec of POSITIVE)",
    'spec.kind === "passportNo" ? { employeeId: f.victimWorker.id }',
    "assert.equal(current.audit.length, prior.audit.length + 1)",
    "assert.equal(actual?.reviewedByUserId, a.owner.id)",
    "assert.equal(optional.id, a.oldOptional.id",
    "assert.equal(decryptGovernmentId(optional.encryptedValue), value)",
    "assert.equal(decryptGovernmentId(employee[spec.kind]), value)",
    "assert.equal(ownApproved, 14",
    "assert.equal(foreignDenied, 2)",
    "assert.equal(forgedDenied, 4)",
    "assert.equal(mismatchDenied, 4)",
    "assert.equal(staleDenied, 2)",
    "assert.equal(conflictDenied, 2)",
    "assert.equal(revokedDenied, 2)",
    "assertVictimPiiUnchanged(beforeVictim, await snapshot(victim.id)",
    "assert.deepEqual(await snapshot(a.org.id), ownBefore",
    "newCoverageCredits: 0, independentlyAccepted: false",
    "moneyMovement: false",
  ]) assert.ok(runner.includes(guard), "Evidence contract removed: " + guard);
  assert.ok(runner.includes('expected: 500') && runner.includes('label: "foreign optional-ID conflict'),
    "Legacy foreign-tenant optional conflict must fail closed, never silently overwrite");
  assert.ok(runner.includes('expected: 403') && runner.includes('expected: 404') &&
    runner.includes('expected: 422') && runner.includes('expected: 409'));
});

test("CI runs separate approval evidence without editing historical pinned runner or claiming credit", () => {
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-second-pass-http\.mjs/);
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-pii01-approval-http\.mjs/);
  assert.match(workflow, /node --check scripts\/qa\/tenant-pii01-approval-http\.mjs/);
  assert.match(workflow, /node --test tests\/tenant-pii01-approval-http\.test\.mjs/);
  assert.ok(!shared.includes("verifyPiiApprovalHttp"), "Historical second-pass runner must remain unmodified");
  assert.ok(!historical.includes("verifyPiiApprovalHttp"), "Prior rejection proof must remain unmodified");
  const start = workflow.indexOf("- name: PII identifier approval PG16 HTTP");
  const end = workflow.indexOf("- name: Show server log on failure", start);
  assert.ok(start >= 0 && end > start, "Separate no-money PG16 approval CI step missing");
  const step = workflow.slice(start, end);
  for (const key of [
    "NODE_ENV", "DEMO_MODE", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_BILLING_ENABLED",
  ]) assert.ok(step.includes(key + ': "' + (key === "NODE_ENV" ? "production" : "false") + '"'),
    "Missing forced-off CI flag: " + key);
  const methods = manifest.allApiRouteFiles["src/app/api/employee-identifier-requests/route.ts"]?.methods;
  assert.deepEqual(methods?.map((row) => [row.name, row.status]), [
    ["GET", "COVERED"], ["POST", "COVERED"],
  ], "The existing provisional methods must not receive fresh credits or state changes");
  assert.ok(!route.includes("test-only"), "Production route must not gain a test bypass");
});
