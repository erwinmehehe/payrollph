import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STUDIO_LIFECYCLE_ORIGIN, STUDIO_LIFECYCLE_ROUTE, PREVIEW_SOURCE_SHA,
  requireDisposableStudioLifecycleEnv, verifyStudioLifecycleSources,
  assertDeniedLifecycle, assertOwnedLifecycle,
} from "../scripts/qa/tenant-studio-lifecycle-contract.mjs";

const env = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_STUDIO_TRIAGE_PROOF: "fictional-only",
  TENANT_STUDIO_DRAFT_PROOF: "fictional-pg16-only",
  TENANT_STUDIO_LIFECYCLE_PROOF: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: STUDIO_LIFECYCLE_ORIGIN,
  TRUSTED_APP_ORIGINS: STUDIO_LIFECYCLE_ORIGIN,
  SECURITY_SMOKE_URL: STUDIO_LIFECYCLE_ORIGIN,
  REQUIRE_PRIVILEGED_MFA: "true", DEMO_MODE: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
  PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const actor = { label: "ATTA", marker: "FICTION-ATTA", org: { id: 13 },
  owner: { id: 24 }, rule: { id: 22 } };
const victim = { label: "VICTIM", marker: "FICTION-VICTIM", org: { id: 90 },
  owner: { id: 75 }, rule: { id: 88 } };
const response = (status, json) => ({
  status, json, text: JSON.stringify(json ?? { error: "Access denied" }),
});

test("synthetic PG16 proof refuses live databases, provider credentials and missing flags", () => {
  assert.equal(requireDisposableStudioLifecycleEnv(env), true);
  for (const unsafe of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { NODE_ENV: "development" }, { BUILD_BLOCK_ACCEPTANCE_MODE: "" },
    { TENANT_STUDIO_LIFECYCLE_PROOF: "" }, { TENANT_STUDIO_DRAFT_PROOF: "" },
    { TENANT_STUDIO_TRIAGE_PROOF: "" },
    { DATABASE_URL: "postgresql://real.production.invalid/app_db" },
    { APP_BASE_URL: "https://customer.example" },
    { SECURITY_SMOKE_URL: "https://customer.example" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "real" }, { XENDIT_SECRET_KEY: "real" },
    { OPENAI_API_KEY: "real" }, { CRON_SECRET: "real" },
    { AUTOMATION_LANGUAGE_STUDIO_ENABLED: "true" },
  ]) {
    assert.throws(() => requireDisposableStudioLifecycleEnv({ ...env, ...unsafe }),
      /STUDIO_LIFECYCLE_REFUSED|STUDIO_DRAFT_REFUSED|STUDIO_TRIAGE_REFUSED/,
      "Unsafe fixture accepted " + JSON.stringify(unsafe));
  }
});

test("owned success must be an actual persisted version for the signed-in employer", () => {
  const good = response(200, {
    rule: { id: 22, organizationId: 13, publishedVersion: 2,
      draftVersion: null, active: true },
    published: { id: 101, ruleId: 22, organizationId: 13,
      version: 2, status: "published", active: true,
      publishedByUserId: actor.owner.id },
  });
  assert.doesNotThrow(() => assertOwnedLifecycle(good, actor, "enable", 2, true));
  for (const invalid of [
    response(201, good.json),
    response(200, { ok: true }),
    response(200, { ...good.json, rule: { ...good.json.rule, organizationId: victim.org.id } }),
    response(200, { ...good.json, rule: { ...good.json.rule, id: victim.rule.id } }),
    response(200, { ...good.json, rule: { ...good.json.rule, publishedVersion: 1 } }),
    response(200, { ...good.json, rule: { ...good.json.rule, draftVersion: 3 } }),
    response(200, { ...good.json, published: { ...good.json.published, organizationId: victim.org.id } }),
    response(200, { ...good.json, published: { ...good.json.published, status: "draft" } }),
    response(200, { ...good.json, published: { ...good.json.published, active: false } }),
    response(200, { ...good.json, published: { ...good.json.published, publishedByUserId: victim.owner.id } }),
  ]) assert.throws(() => assertOwnedLifecycle(invalid, actor, "enable", 2, true));
});

test("foreign denials never disclose rule, published version or employer marker", () => {
  assert.doesNotThrow(() => assertDeniedLifecycle(response(403), 403,
    [actor, victim], "foreign tenant"));
  assert.doesNotThrow(() => assertDeniedLifecycle(response(404), 404,
    [victim], "foreign rule"));
  for (const invalid of [
    response(200, { ok: true }), response(403, { rule: { id: 22 } }),
    response(403, { published: { id: 22 } }), response(403, { previewReceipt: "secret" }),
    response(403, { execution: { id: 1 } }), response(403, { error: victim.marker }),
  ]) assert.throws(() => assertDeniedLifecycle(invalid, 403, [actor, victim], "leak"));
});

test("production route, signed preview and versioned tenant-guard source are pinned", () => {
  assert.equal(STUDIO_LIFECYCLE_ROUTE, "/api/automation-studio");
  assert.match(PREVIEW_SOURCE_SHA, /^[a-f0-9]{40}$/);
  assert.equal(verifyStudioLifecycleSources(), true);
});

test("PG16 runner and workflow cannot silently award whole-POST coverage", () => {
  const proof = readFileSync("scripts/qa/tenant-studio-lifecycle-http.mjs", "utf8");
  const wf = readFileSync(".github/workflows/tenant-studio-lifecycle-qa.yml", "utf8");
  assert.ok(proof.indexOf("requireDisposableStudioLifecycleEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'),
    "Environment guard must run before any DB/app import");
  for (const token of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"',
    'seedEmployer("FILL" + i', 'seedEmployer("VICTIM"',
    "victim.rule.id > 6 && victim.draft.id > 6",
    "freshPreview.json.previewReceipt",
    "victimPreview.json.previewReceipt",
    '"publish-rule"', '"rollback-rule"', '"set-active"',
    "assertOwnedLifecycle(", "assertDeniedLifecycle(",
    "await verifyAllUnchanged(", "allTenantSqlProtected: true",
    "ownedPublications, 2", "ownedActivations, 2",
    "ownedDisables, 2", "ownedRollbacks, 2",
    "foreignDenials, 22", "otherDenials, 19",
    "methodCoverageCredits: 0", "wholePostCertified: false",
    "noExternalProviders: true", "noAutomationExecution: true",
  ]) assert.ok(proof.includes(token), "Missing real HTTP tenant proof: " + token);
  for (const token of [
    "postgres:16", "npm run build",
    "npm ci --include=dev",
    "node --test tests/tenant-studio-lifecycle-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-studio-lifecycle-http.mjs",
    "git rev-parse HEAD",
    "persist-credentials: false",
    'WORKER_ENABLED: "false"',
    'CENTRAL_SCHEDULER_ENABLED: "false"',
    'PAYMONGO_DISBURSEMENTS_ENABLED: "false"',
    'XENDIT_PAYOUTS_ENABLED: "false"',
  ]) assert.ok(wf.includes(token), "Missing isolated CI hardening: " + token);
});
