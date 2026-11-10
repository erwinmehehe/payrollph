import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STUDIO_DRAFT_ORIGIN, STUDIO_DRAFT_ROUTE, STUDIO_DRAFT_TEMPLATE,
  SOURCE_BLOBS, requireDisposableStudioDraftEnv, verifyStudioDraftSources,
  assertDeniedDraft, assertOwnedDraft,
} from "../scripts/qa/tenant-studio-draft-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_STUDIO_TRIAGE_PROOF: "fictional-only",
  TENANT_STUDIO_DRAFT_PROOF: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: STUDIO_DRAFT_ORIGIN, TRUSTED_APP_ORIGINS: STUDIO_DRAFT_ORIGIN,
  SECURITY_SMOKE_URL: STUDIO_DRAFT_ORIGIN, REQUIRE_PRIVILEGED_MFA: "true",
  DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const actor = {
  label: "ATTA", marker: "TTBL-ATTA-TEST", org: { id: 12 },
  owner: { id: 7 },
};
const victim = {
  label: "VICTIM", marker: "TTBL-VICTIM-TEST", org: { id: 50 },
  owner: { id: 45 },
};
const response = (status, json) => ({
  status, json, text: JSON.stringify(json ?? { error: "Denied" }),
});

test("draft proof refuses unsafe databases, credentials, workers, production services and missing guard", () => {
  assert.doesNotThrow(() => requireDisposableStudioDraftEnv(safe));
  for (const change of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" }, { NODE_ENV: "development" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "other" },
    { TENANT_STUDIO_TRIAGE_PROOF: "other" }, { TENANT_STUDIO_DRAFT_PROOF: "" },
    { DATABASE_URL: "postgresql://prod@remote.invalid/app_db" },
    { APP_BASE_URL: "https://real.invalid" },
    { TRUSTED_APP_ORIGINS: "https://real.invalid" },
    { SECURITY_SMOKE_URL: "https://real.invalid" },
    { REQUIRE_PRIVILEGED_MFA: "false" }, { DEMO_MODE: "true" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" }, { FINAL_PAY_SIGNED_REVIEW_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "unsafe" }, { XENDIT_SECRET_KEY: "unsafe" },
    { RESEND_API_KEY: "unsafe" }, { OPENAI_API_KEY: "unsafe" },
    { SMTP_URL: "smtp://remote.invalid" }, { CRON_SECRET: "unsafe" },
  ]) assert.throws(() => requireDisposableStudioDraftEnv({ ...safe, ...change }),
    /STUDIO_TRIAGE_REFUSED|STUDIO_DRAFT_REFUSED/, JSON.stringify(change));
});

test("only a real own inactive, unpublished and persisted draft qualifies as success", () => {
  const full = response(201, {
    created: true,
    rule: { id: 101, organizationId: actor.org.id, name: actor.marker + " draft",
      createdByUserId: actor.owner.id, publishedVersion: 0, draftVersion: 1, active: false },
    draft: { id: 150, ruleId: 101, organizationId: actor.org.id,
      version: 1, status: "draft", name: actor.marker + " draft" },
  });
  assert.doesNotThrow(() => assertOwnedDraft(full, actor, "save-rule", actor.marker + " draft"));
  for (const bad of [
    response(200, full.json),
    response(201, { ok: true }),
    response(201, { ...full.json, created: false }),
    response(201, { ...full.json, rule: { ...full.json.rule, organizationId: victim.org.id } }),
    response(201, { ...full.json, draft: { ...full.json.draft, organizationId: victim.org.id } }),
    response(201, { ...full.json, rule: { ...full.json.rule, active: true } }),
    response(201, { ...full.json, rule: { ...full.json.rule, publishedVersion: 1 } }),
    response(201, { ...full.json, rule: { ...full.json.rule, createdByUserId: victim.owner.id } }),
    response(201, { ...full.json, draft: { ...full.json.draft, status: "published" } }),
  ]) assert.throws(() => assertOwnedDraft(bad, actor, "save-rule", actor.marker + " draft"));
});

test("foreign and forged-resource denial must hide both rule and private tenant data", () => {
  assert.doesNotThrow(() => assertDeniedDraft(response(403), 403, [actor, victim], "foreign org"));
  assert.doesNotThrow(() => assertDeniedDraft(response(404), 404, [victim], "foreign rule"));
  assert.throws(() => assertDeniedDraft(response(200, { ok: true }), 403, [victim], "false denial"));
  assert.throws(() => assertDeniedDraft(response(403, { rule: { id: 50 } }), 403, [victim], "rule leak"));
  assert.throws(() => assertDeniedDraft(response(404, { draft: { id: 50 } }), 404, [victim], "draft leak"));
  assert.throws(() => assertDeniedDraft(response(403, { error: victim.marker }), 403, [victim], "marker leak"));
});

test("real production sources and proof actions are exact-blob pinned, never inferred", () => {
  assert.equal(STUDIO_DRAFT_ROUTE, "/api/automation-studio");
  assert.equal(STUDIO_DRAFT_TEMPLATE, "people-new-hire-core-onboarding");
  assert.equal(Object.keys(SOURCE_BLOBS).length, 4);
  for (const sha of Object.values(SOURCE_BLOBS)) assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(verifyStudioDraftSources(), true);
});

test("PG16 runner requires independent own writes, foreign denials, immutable victim SQL and zero credits", () => {
  const proof = readFileSync("scripts/qa/tenant-studio-draft-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-studio-draft-qa.yml", "utf8");
  assert.ok(proof.indexOf("requireDisposableStudioDraftEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'),
    "Unsafe environments must be refused before DB import");
  for (const token of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    'seedEmployer("FILL" + i', "victim.saved.rule.id > 6",
    "assertCreateDelta(", "assertAllUnchanged(",
    "await post(actor, saveBody(actor, name))",
    "await post(actor, templateBody(actor, templateName))",
    "await post(actor, saveBody(actor, changedName, actor.saved.rule.id))",
    "victim.saved.rule.id),", "ownCreates, 5",
    "ownUpdates, 2", "foreignDenials, 8",
    "wholePostCertified: false", "methodCoverageCredits: 0",
    "automationExecutions: 0", "externalProviders: 0",
  ]) assert.ok(proof.includes(token), "Missing strict tenant proof assertion: " + token);
  for (const token of [
    "postgres:16", "npm run build", "node --import tsx scripts/qa/tenant-studio-draft-http.mjs",
    "persist-credentials: false", "git rev-parse HEAD", "WORKER_ENABLED: \"false\"",
    "PAYMONGO_DISBURSEMENTS_ENABLED: \"false\"",
    "XENDIT_PAYOUTS_ENABLED: \"false\"",
  ]) assert.ok(workflow.includes(token), "Missing CI safety/evidence guard: " + token);
});
