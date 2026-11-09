import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  METHOD, MODES, ORIGIN, SOURCE_PINS, gitBlobSha, assertMethodMode,
  requireFilingPatchRecoveryEnv, verifyFilingPatchSourcePins,
  parseLegacyReceipt, assertAcceptedReceipt, assertRejectedReceipt,
  assertBoundedDenial,
} from "../scripts/qa/tenant-filing-patch-method-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_FILING_OUTCOME_MODE: "fictional-pg16-filing-outcome",
  TENANT_FILING_PATCH_RECOVERY: "fictional-only",
  TENANT_TABLE_PROFILE: "compliance-posts",
  NODE_ENV: "production", DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  MULTI_ENTITY_ENABLED: "false",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: ORIGIN, APP_BASE_URL: "https://payroll.example.test",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "",
  XENDIT_PAYOUT_SECRET_KEY: "", RESEND_API_KEY: "",
  POSTMARK_SERVER_TOKEN: "", SMTP_URL: "", STRIPE_SECRET_KEY: "",
  OPENAI_API_KEY: "",
};
const accepted = {
  method: METHOD, acceptedModes: ["manual_entry", "file_upload"],
  independentFictionalEmployers: 2, higherIdVictim: true,
  realOwnAccepted200: 2, realDenials: 18,
  realAuditRollbacks: 2, crossTenantDbAndAuditImmutable: true,
  evidenceSourceReproduced: true, agencyContacted: false,
  actualAcknowledgementVerified: false, payrollReleasedToRealEmployees: false,
  moneyMoved: false, coverageCredits: 0, independentlyAccepted: false,
};
const rejected = {
  kind: "fictional-compliance-filing-outcome-tenant-proof",
  method: METHOD, attackerEmployers: 2, higherIdVictimEmployers: 1,
  ownPersistedRejections: 2, tenantAndInputDenials: 16,
  foreignEqualsNonexistent: 2, actualAuditVetoRollbacks: 2,
  officialFilingAcceptanceProven: false, submittedToAgency: false,
  moneyMoved: false, coverageCredits: 0,
  independentSecurityReview: "PENDING", productionTested: false,
};
const rsp = (status, json, headers = {}) => ({
  status, json, text: JSON.stringify(json), headers: new Headers(headers),
});

test("method has accepted, rejected and guard modes; no fake receipt-only mode", () => {
  assert.deepEqual(MODES, ["accepted", "rejected", "guards"]);
  for (const mode of MODES) assert.equal(assertMethodMode(mode), mode);
  for (const bad of ["", "fake", "deny-only", "production"]) {
    assert.throws(() => assertMethodMode(bad), /FILING_PATCH_REFUSED/);
  }
});

test("fail-closed local PG16 contract refuses hosted URLs, providers and false claims", () => {
  assert.doesNotThrow(() => requireFilingPatchRecoveryEnv(safe));
  for (const change of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { TENANT_FILING_PATCH_RECOVERY: "approved" },
    { TENANT_SECOND_PASS_MODE: "live" },
    { TENANT_TABLE_PROFILE: "default" },
    { TENANT_FILING_OUTCOME_MODE: "off" },
    { DATABASE_URL: "postgresql://prod.example.invalid/live" },
    { SECURITY_SMOKE_URL: "https://deployed.example.invalid" },
    { APP_BASE_URL: "https://deployed.example.invalid" },
    { REQUIRE_PRIVILEGED_MFA: "false" }, { MULTI_ENTITY_ENABLED: "true" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "secret" }, { RESEND_API_KEY: "secret" },
    { OPENAI_API_KEY: "secret" }, { CRON_SECRET: "secret" },
  ]) assert.throws(() => requireFilingPatchRecoveryEnv({ ...safe, ...change }),
    /FILING_OUTCOME_REFUSED|FILING_PATCH_REFUSED/, JSON.stringify(change));
  const exit = spawnSync(process.execPath, [
    "scripts/qa/tenant-filing-patch-method-http.mjs", "accepted",
  ], { encoding: "utf8", timeout: 10000, env: {
    ...process.env, ...safe, DATABASE_URL: "postgresql://hosted.invalid/production",
  } });
  assert.equal(exit.status, 1);
  assert.match(exit.stderr, /FILING_OUTCOME_REFUSED|FILING_PATCH_REFUSED/);
  assert.doesNotMatch(exit.stderr, /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo/);
});

test("source and both existing HTTP runners are pinned; manifest remains GAP", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 12);
  assert.doesNotThrow(() => verifyFilingPatchSourcePins());
  for (const [path, sha] of Object.entries(SOURCE_PINS)) {
    assert.match(sha, /^[a-f0-9]{40}$/, path);
    assert.equal(gitBlobSha(readFileSync(path)), sha, path);
  }
  assert.throws(() => verifyFilingPatchSourcePins(p =>
    p === "src/app/api/compliance/filing-validations/[id]/route.ts"
      ? Buffer.from("unreviewed route") : readFileSync(p)),
  /source drift requires new independent review/);
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const row = manifest.allApiRouteFiles[
    "src/app/api/compliance/filing-validations/[id]/route.ts"
  ]?.methods.find(x => x.name === "PATCH");
  assert.equal(row?.status, "GAP");
  assert.equal(row?.testedBy, null);
});

test("false positive, missing victim, audit omission and fake credit are rejected", () => {
  assert.deepEqual(assertAcceptedReceipt(accepted), accepted);
  assert.deepEqual(assertRejectedReceipt(rejected), rejected);
  assert.deepEqual(parseLegacyReceipt("accepted",
    "TENANT_COMPLIANCE_ACCEPTED_HTTP_PASS " + JSON.stringify(accepted) + "\n"),
  accepted);
  assert.deepEqual(parseLegacyReceipt("rejected",
    "prior data\n" + JSON.stringify(rejected, null, 2) + "\n"),
  rejected);
  for (const change of [
    { realOwnAccepted200: 0 }, { realDenials: 1 },
    { higherIdVictim: false }, { realAuditRollbacks: 0 },
    { coverageCredits: 1 }, { agencyContacted: true },
    { crossTenantDbAndAuditImmutable: false }, { independentlyAccepted: true },
  ]) assert.throws(() => assertAcceptedReceipt({ ...accepted, ...change }));
  for (const change of [
    { ownPersistedRejections: 0 }, { tenantAndInputDenials: 2 },
    { higherIdVictimEmployers: 0 }, { actualAuditVetoRollbacks: 0 },
    { coverageCredits: 1 }, { moneyMoved: true },
    { independentSecurityReview: "APPROVED" },
  ]) assert.throws(() => assertRejectedReceipt({ ...rejected, ...change }));
  assert.throws(() => parseLegacyReceipt("accepted", "HTTP 200 success"));
  assert.throws(() => parseLegacyReceipt("rejected", "{}"));
});

test("role/MFA denial oracle blocks false success and marker disclosure", () => {
  assert.doesNotThrow(() => assertBoundedDenial(
    rsp(403, { error: "Forbidden" }), 403,
    ["VICTIM-TEST-MARKER"], "denied"));
  for (const bad of [
    rsp(200, { error: "Forbidden" }),
    rsp(403, { error: "Forbidden", record: { id: 99 } }),
    rsp(403, { error: "VICTIM-TEST-MARKER" }),
    rsp(403, { message: "Forbidden" }),
    rsp(403, { error: "Denied" }, { "x-debug": "VICTIM-TEST-MARKER" }),
  ]) assert.throws(() => assertBoundedDenial(
    bad, 403, ["VICTIM-TEST-MARKER"], "denied"));
});

test("exact-head workflow must run three independent PG16 HTTP legs", () => {
  const wf = readFileSync(".github/workflows/tenant-filing-patch-method-qa.yml", "utf8");
  for (const key of [
    "postgres:16", "contents: read", "persist-credentials: false",
    "ref: ${{ github.event.pull_request.head.sha || github.sha }}",
    "EXPECTED_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
    "npm ci", "npm run db:push", "npm run build",
    "node scripts/qa/apply-isolated-baseline.mjs",
    "node --test tests/tenant-filing-patch-method-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-filing-patch-method-http.mjs",
    "node scripts/qa/tenant-table-env.mjs compliance-posts",
    "TENANT_FILING_PATCH_RECOVERY=fictional-only", "matrix:",
    "accepted", "rejected", "guards",
    "needs.filing-method-leg.result",
  ]) assert.ok(wf.includes(key), "Missing protected workflow step: " + key);
  assert.ok(!wf.includes("npm run db:migrate:production"));
  assert.ok(!wf.includes("vercel deploy"));
  const src = readFileSync("scripts/qa/tenant-filing-patch-method-http.mjs", "utf8");
  assert.ok(src.indexOf("requireFilingPatchRecoveryEnv();") <
    src.indexOf('import("../../src/db/index.ts")'));
  assert.ok(src.includes("parseLegacyReceipt(which, child.stdout)"));
  assert.ok(src.includes('mode === "guards"'));
});
