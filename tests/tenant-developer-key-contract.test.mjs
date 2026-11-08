import {verifySecurityCredits,SECURITY_TARGETS,readSecurityEvidence} from '../scripts/qa/tenant-security-write-credit.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDeveloperKeyProofEnvironment, requireHttpStatus,
  assertOneTimeKeyCreated, assertForeignKeyDenial,
} from "../scripts/qa/tenant-developer-key-contract.mjs";

const env = {
  CI: "true", GITHUB_ACTIONS: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_DEVELOPER_KEY_PROOF: "fictional-pg16-http-only",
  NODE_ENV: "production", DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  APP_BASE_URL: "https://payroll.example.test",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PII_ENCRYPTION_KEY: "1".repeat(64),
};
const resp = (status, json) => ({
  status, json, text: JSON.stringify(json),
  headers: new Headers({ "content-type": "application/json" }),
});

test("proof refuses anything except exact disposable GitHub PG16/Next and payout OFF", () => {
  assert.doesNotThrow(() => requireDeveloperKeyProofEnvironment(env));
  const mutations = [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["TENANT_DEVELOPER_KEY_PROOF", ""], ["NODE_ENV", "development"],
    ["TENANT_SECOND_PASS_MODE", ""],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/real_customers"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.example.invalid:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require"],
    ["SECURITY_SMOKE_URL", "https://cloud.example.invalid"],
    ["APP_BASE_URL", "https://payroll.company.example"],
    ["PII_ENCRYPTION_KEY", "unsafe"],
    ["WORKER_ENABLED", "true"], ["XENDIT_BILLING_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"], ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "dummy"], ["RESEND_API_KEY", "dummy"],
    ["NEON_DATABASE_URL", "postgresql://example.invalid/customers"],
    ["DOCUMENT_OBJECT_STORAGE_ENDPOINT", "https://example.invalid"],
  ];
  for (const [name, value] of mutations) {
    assert.throws(() => requireDeveloperKeyProofEnvironment({ ...env, [name]: value }),
      /DEV_KEY_PROOF_REFUSED/, name);
  }
});

test("one-time key proof cannot pass a fake success, HTML or leaked hash", () => {
  const valid = { id: 89, name: "Owned key", key: "sk_live_" + "a".repeat(48), scopes: ["employees:read"] };
  assert.doesNotThrow(() => assertOneTimeKeyCreated(resp(201, valid), "Owned key"));
  assert.throws(() => assertOneTimeKeyCreated(resp(403, valid), "Owned key"));
  assert.throws(() => assertOneTimeKeyCreated(resp(201, { ...valid, id: 0 }), "Owned key"));
  assert.throws(() => assertOneTimeKeyCreated(resp(201, { ...valid, key: "fake" }), "Owned key"));
  assert.throws(() => assertOneTimeKeyCreated(resp(201, { ...valid, keyHash: "hash" }), "Owned key"));
  assert.throws(() => requireHttpStatus({ ...resp(201, valid), headers: new Headers({ "content-type": "text/html" }) }, 201, "JSON"));
});

test("foreign key denial must equal genuinely nonexistent key denial", () => {
  const no = resp(404, { error: "Key not found in this workspace." });
  assert.doesNotThrow(() => assertForeignKeyDenial(no, no, 88));
  assert.throws(() => assertForeignKeyDenial(resp(200, { ok: true }), no, 88));
  assert.throws(() => assertForeignKeyDenial(resp(404, { error: "victim key 88 exists" }), no, 88));
  assert.throws(() => assertForeignKeyDenial(resp(404, { error: "sk_live_secret" }), no, 88));
});

test("runner has real two-tenant positives, own-victim SQL invariants and zero credits", () => {
  const runner = readFileSync(new URL("../scripts/qa/tenant-developer-key-http.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("requireDeveloperKeyProofEnvironment();") >= 0);
  assert.ok(runner.indexOf("requireDeveloperKeyProofEnvironment();") < runner.indexOf('import("../../src/db/index.ts")'));
  for (const phrase of [
    'seedEmployer("DEV_A"', 'seedEmployer("DEV_B"', 'seedEmployer("DEV_VICTIM"',
    "victimKey.id > 6", "independentAttackers: 2", "ownCreatedIds.size, 2",
    "assertForeignKeyDenial(", "bodySelectorForgeryConfinedToOwnEmployer: true",
    "unitScopeAndRevokedMembershipDenied: true",
    "same session survives employer grant revocation",
    "victimSqlAndAuditUnchanged: true", "webhookDeliveryAttempted: securityWriteRun()",
    "actualEmployeeApiOwnDataBeforeRevocation: true",
    "foreignEmployerQueryIgnoredForKey: true",
    "revokedKeyDeniedAtConsumerViaBothHeaders: true",
    "new key reads only own employees despite forged employer selector",
    "revoked key refused at employee API",
    "revoked key refused via x-api-key header",
    "previously valid revoked key cannot leak existence through API errors",
    "revoked and invalid key requests must not update last-used, keys, staff or audits",
    'POST_method_status: "GAP"', "newCoverageCredits: 0",
  ]) assert.ok(runner.includes(phrase), "missing evidence: " + phrase);
  assert.ok(runner.includes('if(securityWriteRun())'),'Full webhook actions are reserved to strict egress-blocked fixture mode');
  assert.equal(readSecurityEvidence().runs.developer.result.webhookTests,2);
});

test("GitHub workflow uses only fake PG16, full Next HTTP and disabled money/provider flags", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tenant-developer-key-http.yml", import.meta.url), "utf8");
  assert.match(workflow, /postgres:16/);
  assert.match(workflow, /npm run db:push/);
  assert.match(workflow, /node scripts\/qa\/apply-isolated-baseline\.mjs/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-developer-key-http\.mjs/);
  assert.match(workflow, /node scripts\/qa\/tenant-table-env\.mjs compliance-posts/);
  assert.match(workflow, /TENANT_DEVELOPER_KEY_PROOF: fictional-pg16-http-only/);
  assert.doesNotMatch(workflow, /secrets\.|actions\/upload-artifact/, "no live credentials or credential-bearing artifacts");
});

test("coverage stays GAP and source/coverage ledger are untouched", () => {
  const manifest = JSON.parse(readFileSync(new URL("../scripts/qa/tenant-isolation-coverage-manifest.json", import.meta.url), "utf8"));
  const entry = manifest.allApiRouteFiles["src/app/api/developer/route.ts"];
  assert.ok(entry, "source-pinned developer route required");
  const target = entry.methods.find(method => method.name === "POST");
  assert.equal(target?.status,'COVERED');assert.equal(verifySecurityCredits(manifest),3);
});


function gitBlob(filePath) {
  const contents = readFileSync(new URL("../" + filePath, import.meta.url));
  return createHash("sha1").update("blob " + contents.length + "\0").update(contents).digest("hex");
}

test("actual developer authentication, employee consumer and key-audit source hashes are pinned", () => {
  const refs = {
    "src/app/api/developer/route.ts": "f8ecdf3fc0063e296ded7184010237e37373cbd0",
    "src/lib/api-auth.ts": "eac6c92c5e875c3267b7d7d6c0053bfeee93900a",
    "src/app/api/v1/employees/route.ts": "4202bbf80a6aa0f951b34ec0b228fb8655daf839",
    "src/lib/developer-security-mutations.ts": "d9e096588b9da32c066d5450865e87cc039e1e38",

  };
  for (const [path, sha] of Object.entries(refs)) {
    assert.equal(gitBlob(path), sha,
      path + ": changed source invalidates the saved tenant boundary proof, re-run final-head PG16 HTTP");
  }
  assert.equal(gitBlob('scripts/qa/tenant-developer-key-http.mjs'),readSecurityEvidence().pins['scripts/qa/tenant-developer-key-http.mjs']);
  const auth = readFileSync(new URL("../src/lib/api-auth.ts", import.meta.url), "utf8");
  const employees = readFileSync(new URL("../src/app/api/v1/employees/route.ts", import.meta.url), "utf8");
  assert.match(auth, /eq\(apiKeys\.keyHash, sha256\(token\)\)/);
  assert.match(auth, /isNull\(apiKeys\.revokedAt\)/);
  assert.match(employees, /authenticateApiKey\(request\)/);
  assert.match(employees, /requireScope\(auth\.scopes, "employees:read"\)/);
  assert.match(employees, /eq\(employees\.organizationId, auth\.organizationId\)/);
  assert.doesNotMatch(employees, /eq\(employees\.organizationId, (?:searchParams|organizationId|request)\b/,
    "credential owner employer must not be replaced by a caller-provided organizationId");
  const script = readFileSync(new URL("../scripts/qa/tenant-developer-key-http.mjs", import.meta.url), "utf8");
  assert.ok(script.indexOf("requireDeveloperKeyProofEnvironment();") >= 0);
  assert.ok(script.indexOf("requireDeveloperKeyProofEnvironment();") < script.indexOf('import("../../src/db/index.ts")'),
    "the disposable-only proof refusal precedes database import");
  assert.match(script, /for \(const actor of \[a, b\]\)/);
  assert.match(script, /apiEmployeeList\([\s\S]*?created\.json\.key, "\?organizationId=" \+ victim\.org\.id/);
  assert.match(script, /const deniedAfterRevoke = requireHttpStatus\(await apiEmployeeList\(/);
  assert.match(script, /assert\.deepEqual\(deniedAfterRevoke\.json, unknownKey\.json/);
  assert.match(script, /assert\.deepEqual\(await snapshotOrganization\(victim\.org\.id\), victimBefore/);
});
