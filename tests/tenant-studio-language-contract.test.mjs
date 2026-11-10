import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, ROUTE, PROMPT, SOURCE_BLOBS,
  requireDisposableStudioLanguageEnv, verifyStudioLanguageSources,
  assertDeniedLanguage, assertOwnProposal, assertOwnedLanguageSave,
} from "../scripts/qa/tenant-studio-language-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_STUDIO_TRIAGE_PROOF: "fictional-only",
  TENANT_STUDIO_DRAFT_PROOF: "fictional-pg16-only",
  TENANT_STUDIO_LANGUAGE_PROOF: "fictional-pg16-only",
  AUTOMATION_LANGUAGE_ACCEPTANCE_MODE: "synthetic-postgres-only",
  OPENAI_AUTOMATION_DRAFT_ENABLED: "false",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  SECURITY_SMOKE_URL: ORIGIN, REQUIRE_PRIVILEGED_MFA: "true",
  DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
  PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const a = { label: "ATTA", marker: "FICTION-ATTA",
  org: { id: 31 }, owner: { id: 20 } };
const victim = { label: "VICTIM", marker: "FICTION-VICTIM",
  org: { id: 90 }, owner: { id: 76 } };
const response = (status, json) => ({
  status, json, text: JSON.stringify(json ?? { error: "Denied" }),
});

test("only the local model-disabled synthetic release gate may enable positive language proof", () => {
  assert.equal(requireDisposableStudioLanguageEnv(safe), true);
  for (const patch of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { NODE_ENV: "development" }, { BUILD_BLOCK_ACCEPTANCE_MODE: "" },
    { TENANT_STUDIO_TRIAGE_PROOF: "" }, { TENANT_STUDIO_DRAFT_PROOF: "" },
    { TENANT_STUDIO_LANGUAGE_PROOF: "" },
    { AUTOMATION_LANGUAGE_ACCEPTANCE_MODE: "" },
    { AUTOMATION_LANGUAGE_STUDIO_ENABLED: "true" },
    { AUTOMATION_LANGUAGE_STUDIO_ENABLED: "false" },
    { OPENAI_AUTOMATION_DRAFT_ENABLED: "true" },
    { DATABASE_URL: "postgresql://prod.example.com/production" },
    { APP_BASE_URL: "https://customer.invalid" },
    { SECURITY_SMOKE_URL: "https://customer.invalid" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" },
    { OPENAI_API_KEY: "real" }, { XENDIT_SECRET_KEY: "real" },
    { CRON_SECRET: "real" },
  ]) assert.throws(() => requireDisposableStudioLanguageEnv({ ...safe, ...patch }),
    /STUDIO_LANGUAGE_REFUSED|STUDIO_DRAFT_REFUSED|STUDIO_TRIAGE_REFUSED/,
    "Unsafe environment accepted: " + JSON.stringify(patch));
});

test("real own proposal requires approved local template, typed actions and signed receipt", () => {
  const valid = response(200, {
    source: "approved-template", validation: { valid: true },
    proposalReceipt: "fictional-test-only-signed-session-proof".repeat(2),
    draft: { trigger: "employee.hired", actions: [{ type: "create_task" }, { type: "send_email" }] },
  });
  assert.doesNotThrow(() => assertOwnProposal(valid));
  for (const invalid of [
    response(403, valid.json),
    response(200, { ...valid.json, source: "external-model" }),
    response(200, { ...valid.json, validation: { valid: false } }),
    response(200, { ...valid.json, proposalReceipt: "" }),
    response(200, { ...valid.json, draft: { trigger: "employee.hired", actions: [] } }),
    response(200, { ...valid.json, draft: { trigger: "other", actions: valid.json.draft.actions } }),
  ]) assert.throws(() => assertOwnProposal(invalid));
});

test("signed save must be a real persisted inactive own-employer workflow", () => {
  const good = response(201, {
    created: true,
    rule: { id: 71, organizationId: a.org.id, createdByUserId: a.owner.id,
      active: false, publishedVersion: 0, draftVersion: 1 },
    draft: { id: 90, organizationId: a.org.id, ruleId: 71,
      createdByUserId: a.owner.id, status: "draft", version: 1, active: false },
  });
  assert.doesNotThrow(() => assertOwnedLanguageSave(good, a));
  for (const bad of [
    response(200, good.json), response(201, { ok: true }),
    response(201, { ...good.json, rule: { ...good.json.rule, organizationId: victim.org.id } }),
    response(201, { ...good.json, rule: { ...good.json.rule, active: true } }),
    response(201, { ...good.json, rule: { ...good.json.rule, publishedVersion: 1 } }),
    response(201, { ...good.json, draft: { ...good.json.draft, organizationId: victim.org.id } }),
    response(201, { ...good.json, draft: { ...good.json.draft, active: true } }),
    response(201, { ...good.json, draft: { ...good.json.draft, status: "published" } }),
    response(201, { ...good.json, draft: { ...good.json.draft, createdByUserId: victim.owner.id } }),
  ]) assert.throws(() => assertOwnedLanguageSave(bad, a));
});

test("foreign/forged denials never leak a workflow, token or employer marker", () => {
  assert.doesNotThrow(() => assertDeniedLanguage(response(403), 403, [a,victim], "foreign org"));
  assert.doesNotThrow(() => assertDeniedLanguage(response(409), 409, [a,victim], "foreign token"));
  for (const bad of [
    response(200, { ok: true }), response(403, { rule: { id: 1 } }),
    response(403, { draft: { id: 1 } }),
    response(403, { proposalReceipt: "private" }),
    response(403, { error: victim.marker }),
  ]) assert.throws(() => assertDeniedLanguage(bad, 403, [a,victim], "privacy"));
});

test("source pins cover language release, builder, receipt and existing Studio gates", () => {
  assert.equal(ROUTE, "/api/automation-studio");
  assert.ok(PROMPT.includes("onboarding checklist"));
  assert.equal(Object.keys(SOURCE_BLOBS).length, 3);
  for (const sha of Object.values(SOURCE_BLOBS)) assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(verifyStudioLanguageSources(), true);
});

test("real PG16 HTTP runner and workflow require own save, cross-org receipt and zero credits", () => {
  const proof = readFileSync("scripts/qa/tenant-studio-language-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-studio-language-qa.yml", "utf8");
  assert.ok(proof.indexOf("requireDisposableStudioLanguageEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'));
  for (const token of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"',
    'seedEmployer("FILL" + i', 'seedEmployer("VICTIM"',
    "victim.saved.rule.id > 6 && victim.saved.draft.id > 6",
    "assertOwnProposal(", "assertOwnedLanguageSave(",
    "assertDeniedLanguage(", "await unchanged(",
    "victim.proposal.receipt", "ownProposals, 3",
    "signedOwnSaves, 3", "foreignDenials, 8",
    "otherDenials, 12", "noExternalModel: true",
    "noPublishedOrActiveRule: true",
    "wholePostCertified: false", "methodCoverageCredits: 0",
  ]) assert.ok(proof.includes(token), "Missing real proof element: " + token);
  for (const token of [
    "postgres:16", "npm ci --include=dev", "npm run build",
    "node --test tests/tenant-studio-language-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-studio-language-http.mjs",
    "git rev-parse HEAD", "persist-credentials: false",
    'OPENAI_AUTOMATION_DRAFT_ENABLED: "false"',
    'WORKER_ENABLED: "false"',
    'CENTRAL_SCHEDULER_ENABLED: "false"',
  ]) assert.ok(workflow.includes(token), "Unsafe or missing language PG16 acceptance step: " + token);
});
