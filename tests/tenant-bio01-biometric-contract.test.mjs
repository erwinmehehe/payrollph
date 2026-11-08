import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BIO01_ROUTE, BIO01_ROUTE_SHA, BIO01_HELPER, BIO01_HELPER_SHA,
  requireDisposableBio01, assertBio01Denied, assertBio01Owned,
  assertBio01Unchanged,
} from "../scripts/qa/tenant-bio01-biometric-contract.mjs";

const runnerPath = "scripts/qa/tenant-bio01-biometric-http.mjs";
const workflowPath = ".github/workflows/tenant-bio01-biometric-http.yml";
const gitSha = contents => {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
};
function env() {
  return {
    CI: "true", GITHUB_ACTIONS: "true",
    BIO01_MODE: "fictional-pg16-localhost",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    NODE_ENV: "production", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    BIOMETRIC_INGEST_SECRET: "ci-bio01-" + "a".repeat(64),
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "",
    XENDIT_PAYOUT_SECRET_KEY: "", RESEND_API_KEY: "",
    POSTMARK_SERVER_TOKEN: "", SMTP_URL: "", STRIPE_SECRET_KEY: "",
  };
}

test("BIO-01 rejects remote databases, provider keys, missing guards and nonrandom HMAC roots", () => {
  const safe = env();
  assert.equal(requireDisposableBio01(safe), true);
  const defects = [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"], ["BIO01_MODE", ""],
    ["TENANT_SECOND_PASS_MODE", ""], ["NODE_ENV", "development"],
    ["DEMO_MODE", "true"], ["REQUIRE_PRIVILEGED_MFA", "false"],
    ["DATABASE_URL", "postgresql://postgres:postgres@neon.example.test:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/live"],
    ["APP_BASE_URL", "https://production.example.com"],
    ["SECURITY_SMOKE_URL", "http://localhost:3000"],
    ["BIOMETRIC_INGEST_SECRET", "production-secret"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"], ["XENDIT_BILLING_ENABLED", "true"],
    ["WORKER_ENABLED", "true"], ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "live"], ["RESEND_API_KEY", "live"],
    ["SMTP_URL", "smtp://external.example"],
  ];
  for (const [key, value] of defects) {
    assert.throws(() => requireDisposableBio01({ ...safe, [key]: value }),
      /BIO01_REFUSED/, "unexpected acceptance of " + key);
  }
  assert.throws(() => requireDisposableBio01({}), /BIO01_REFUSED/);
});

test("BIO-01 refuses false successes and any foreign device marker leakage", () => {
  const denied = { status: 403, json: { error: "Not allowed." },
    text: '{"error":"Not allowed."}' };
  assert.equal(assertBio01Denied(denied, 403).status, 403);
  assert.throws(() => assertBio01Denied({ ...denied, status: 200 }, 403));
  assert.throws(() => assertBio01Denied({ ...denied,
    json: { error: "No", ingested: 1 } }, 403));
  assert.throws(() => assertBio01Denied({ ...denied,
    text: 'VICTIM-DEVICE-SECRET' }, 403, ["VICTIM-DEVICE-SECRET"]));
  const ok = { status: 200, json: {
    ok: true, deviceSerial: "OWN-001", ingested: 1,
    duplicates: 0, unmatched: 0, invalid: 0, locked: 0,
    syncedAt: "2026-11-08T00:00:00.000Z", attendanceExceptionSync: [],
  } };
  ok.text = JSON.stringify(ok.json);
  assert.equal(assertBio01Owned(ok, { deviceSerial: "OWN-001", ingested: 1 }).ingested, 1);
  assert.throws(() => assertBio01Owned(ok, { ingested: 2 }));
  assert.throws(() => assertBio01Owned({ ...ok, text: ok.text + "VICTIM" },
    { ingested: 1 }, ["VICTIM"]));
  assert.throws(() => assertBio01Unchanged({ punches: [1] },
    { punches: [1, 2] }, "foreign"));
});

test("BIO-01 source pins the exact device binding and leaves canonical POST a GAP", () => {
  assert.equal(gitSha(readFileSync(BIO01_ROUTE)), BIO01_ROUTE_SHA,
    "biometric ingestion changed; independently re-review source");
  assert.equal(gitSha(readFileSync(BIO01_HELPER)), BIO01_HELPER_SHA,
    "HMAC credential binding changed; independently re-review");
  const route = readFileSync(BIO01_ROUTE, "utf8");
  const helper = readFileSync(BIO01_HELPER, "utf8");
  for (const mark of [
    "enforceSameOriginMutation(request)", "getSessionUser()",
    "assertOrganizationRole(", "acceptsDeviceSecret(request, organizationId, deviceSerial)",
    "eq(biometricDevices.organizationId, organizationId)",
    "eq(biometricDevices.serialNumber, deviceSerial)",
    "eq(employees.organizationId, organizationId)",
    "eq(timePunches.organizationId, organizationId)",
    "eq(timePunches.employeeId, employee.id)",
    'action: "Biometric attendance logs synced"',
  ]) assert.ok(route.includes(mark), "BIO-01 source boundary changed: " + mark);
  for (const mark of ["createHmac(", "timingSafeEqual(", "organizationId", "normalizedSerial"]) {
    assert.ok(helper.includes(mark), "BIO-01 credential binding changed: " + mark);
  }
  const ledger = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json"));
  const methods = ledger.allApiRouteFiles[BIO01_ROUTE]?.methods;
  assert.equal(methods?.find(m => m.name === "POST")?.status, "GAP");
  assert.equal(methods?.find(m => m.name === "POST")?.testedBy, null);
  assert.equal(methods?.find(m => m.name === "GET")?.status, "COVERED",
    "do not accidentally downgrade already evidenced GET");
  assert.match(ledger.acceptanceStatus, /^NOT ACCEPTED:/);
});

test("BIO-01 real PG16 runner covers own devices, denied foreign and revoked sessions", () => {
  const source = readFileSync(runnerPath, "utf8");
  assert.ok(source.indexOf("requireDisposableBio01();") <
    source.indexOf('import("../../src/db/index.ts")'),
    "no application or DB imports before disposable guard");
  for (const mark of [
    "SHOW server_version_num", '"ATTA"', '"ATTB"', '"VICTIM"',
    "victim.worker.id > a.worker.id", "victim.device.id > a.device.id",
    "biometricDeviceCredential", "Authorization", "foreign-organization",
    "foreign-device", "victim-worker", "bad-secret", "replay-unchanged",
    "cross-site", "revoked-session", "assertBio01Denied",
    "assertBio01Owned", "assertBio01Unchanged",
    "newCoverageCredits: 0", 'independentSecurityReview: "PENDING"',
  ]) assert.ok(source.includes(mark), "BIO-01 runner missing: " + mark);
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1)[^\s"']+/.test(source),
    "no external HTTP URL may appear in proof runner");
});

test("BIO-01 has its own synthetic-only workflow, never a production/money action", () => {
  const source = readFileSync(workflowPath, "utf8");
  for (const mark of [
    "postgres:16", "npm ci", "npm run db:push",
    "node scripts/qa/apply-isolated-baseline.mjs", "npm run build",
    "npm start -- -H 127.0.0.1",
    "tenant-bio01-biometric-http.mjs",
    "tenant-bio01-biometric-contract.test.mjs",
    "BIOMETRIC_INGEST_SECRET", "openssl rand -hex 32",
    "PAYMONGO_DISBURSEMENTS_ENABLED: 'false'",
    "XENDIT_PAYOUTS_ENABLED: 'false'",
    "WORKER_ENABLED: 'false'", "CENTRAL_SCHEDULER_ENABLED: 'false'",
    "permissions:", "contents: read", "persist-credentials: false",
  ]) assert.ok(source.includes(mark), "BIO-01 unsafe/incomplete workflow: " + mark);
  assert.ok(!source.includes("workflow_dispatch:"), "no arbitrary manual environment execution");
});
