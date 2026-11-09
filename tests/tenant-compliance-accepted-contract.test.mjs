import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, PROOF_MODE, ENDPOINT, requireDisposableFilingEnv,
} from "../scripts/qa/tenant-filing-outcome-contract.mjs";

const RUNNER = "scripts/qa/tenant-compliance-accepted-http.mjs";
const WORKFLOW = ".github/workflows/tenant-compliance-accepted-http.yml";
const ROUTE = "src/app/api/compliance/filing-validations/[id]/route.ts";
const STORE = "src/lib/filing-evidence-store.ts";
const read = path => readFileSync(path, "utf8");

const safe = {
  CI: "true", GITHUB_ACTIONS: "true",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_FILING_OUTCOME_MODE: PROOF_MODE,
  TENANT_COMPLIANCE_ACCEPTED_BATCH: "fictional-only",
  NODE_ENV: "production", DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: ORIGIN,
  APP_BASE_URL: "https://payroll.example.test",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "",
  XENDIT_PAYOUT_SECRET_KEY: "", RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "",
  SMTP_URL: "", STRIPE_SECRET_KEY: "", OPENAI_API_KEY: "",
};

test("separate compliance batch requires disposable PG16, no provider, no real staff", () => {
  assert.equal(requireDisposableFilingEnv(safe), true);
  assert.equal(safe.TENANT_COMPLIANCE_ACCEPTED_BATCH, "fictional-only");
  for (const replacement of [
    { DATABASE_URL: "postgresql://real.neon.tech/db" },
    { SECURITY_SMOKE_URL: "https://production.example" },
    { APP_BASE_URL: "https://customer.example" },
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "some-secret" },
    { XENDIT_BILLING_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" },
    { RESEND_API_KEY: "some-secret" },
  ]) {
    assert.throws(() => requireDisposableFilingEnv({ ...safe, ...replacement }),
      "Unsafe environment allowed " + JSON.stringify(replacement));
  }
  const proof = read(RUNNER);
  assert.ok(proof.indexOf("requireDisposableFilingEnv();") > 0);
  assert.ok(proof.indexOf("requireDisposableFilingEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'));
  assert.ok(proof.indexOf("TENANT_COMPLIANCE_ACCEPTED_BATCH") <
    proof.indexOf('import("../../src/db/index.ts")'));
  assert.doesNotMatch(proof, /^import .*from "\.\.\/\.\.\/src\/db/m);
});

test("source remains the reviewed employer-bound filing PATCH, not modified in this batch", () => {
  const bytes = readFileSync(ROUTE);
  const gitSha = createHash("sha1")
    .update("blob " + bytes.length + "\0").update(bytes).digest("hex");
  assert.equal(gitSha, "09f642a67035dc9ce22fa502d80518ba18641b0f");
  const route = bytes.toString("utf8");
  const store = read(STORE);
  for (const marker of [
    "enforceSameOriginMutation(request)", "getSessionUser()",
    "assertOrganizationRole(", "requireSensitiveActionMfa(user)",
    "getFilingValidation(organizationId, id)",
    "assertEntityResource(scope.context, existing.legalEntityId)",
    "assertOrganizationUnitAccess(", "db.transaction(",
    "recordFilingOutcome(", "tx.insert(auditEvents)",
  ]) assert.ok(route.includes(marker), "Expected source authorization: " + marker);
  for (const marker of [
    'if (outcome.outcome === "accepted")',
    'run.status !== "Released"',
    "await regenerateRecordedFile(source)",
    'eq(governmentFilingValidations.organizationId, input.organizationId)',
    'eq(governmentFilingValidations.status, "generated")',
  ]) assert.ok(store.includes(marker), "Missing accepted filing store guard: " + marker);
  assert.equal(ENDPOINT, "/api/compliance/filing-validations/");
});

test("real HTTP contract requires both genuine accepted modes and foreign invariants", () => {
  const proof = read(RUNNER);
  for (const phrase of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"',
    'seedEmployer("VICTIM"', 'seedEmployer("PAD"',
    '"Released"', 'recordGeneratedFiling({',
    'source.file?.body?.includes(actor.worker.lastName)',
    '"2026-02-28"',
    'victim.filing.id > Math.max(a.filing.id, b.filing.id, 6)',
    'new Set([a.cookie, b.cookie, victim.cookie]).size, 3',
    '"manual_entry"', '"file_upload"',
    'assert.equal(response.status, 200',
    'stored.status, "accepted"',
    'assert.equal(stored.fileSha256, actor.filing.fileSha256)',
    'assert.equal(after.auditEvents.length,',
    'await withDisposableInsertVeto(pool, "audit_events"',
    'await immutable(beforeVeto, "actual PostgreSQL audit veto")',
    'await rejected(victim.filing.id, 403',
    'await rejected(victim.filing.id, 404',
    'assert.deepEqual(foreign.json, absent.json',
    'assertFilingStateUnchanged(victimBefore, await snapshot(victim.org.id)',
    'assert.equal(denied, 18)',
    'assert.equal(accepted, 2)',
    'assert.equal(auditRollbacks, 2)',
    'coverageCredits: 0', 'independentlyAccepted: false',
    'agencyContacted: false',
  ]) assert.ok(proof.includes(phrase), "Missing accepted-path method proof: " + phrase);
  assert.doesNotMatch(proof, /coverageCredits:\s*[1-9]/);
});

test("CI runs only on exact PR SHA with fictional PostgreSQL 16 and no real money", () => {
  const wf = read(WORKFLOW);
  for (const marker of [
    "postgres:16", "contents: read", "persist-credentials: false",
    "git rev-parse HEAD", "TENANT_COMPLIANCE_ACCEPTED_BATCH=fictional-only",
    "node scripts/qa/tenant-table-env.mjs compliance-posts",
    "npm run db:push", "node scripts/qa/apply-isolated-baseline.mjs",
    "npm run build", "npm start -- -H 127.0.0.1",
    "node --import tsx scripts/qa/tenant-compliance-accepted-http.mjs",
    'PAYMONGO_DISBURSEMENTS_ENABLED=false',
    'XENDIT_PAYOUTS_ENABLED=false',
    'XENDIT_BILLING_ENABLED=false',
  ]) assert.ok(wf.includes(marker), "Missing CI safety or proof step: " + marker);
  assert.doesNotMatch(wf, /vercel deploy|production migration|db:migrate:production|paymongo\.com|xendit\.co/i);
});
