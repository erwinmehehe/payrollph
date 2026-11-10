import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, ROUTE, SOURCE_BLOBS,
  requireDisposableStudioExecutionEnv, verifyStudioExecutionSources,
  assertDeniedExecution, assertOwnedCase, assertOwnRecovery,
} from "../scripts/qa/tenant-studio-execution-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_STUDIO_TRIAGE_PROOF: "fictional-only",
  TENANT_STUDIO_DRAFT_PROOF: "fictional-pg16-only",
  TENANT_STUDIO_EXECUTION_PROOF: "fictional-pg16-only",
  AUTOMATION_LANGUAGE_STUDIO_ENABLED: "false",
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
const actor = {
  label: "ATTA", marker: "FICTION-ATTA", org: { id: 12 },
  owner: { id: 24 }, worker: { id: 40 }, rule: { id: 33 },
  failed: { id: 100 }, replaySource: { id: 101 },
};
const victim = {
  label: "VICTIM", marker: "FICTION-VICTIM", org: { id: 93 },
  owner: { id: 90 }, worker: { id: 86 }, rule: { id: 85 },
  failed: { id: 110 }, replaySource: { id: 111 },
};
const response = (status, json) => ({
  status, json, text: JSON.stringify(json ?? { error: "Denied" }),
});

test("fixture rejects unsafe destinations, model flags, money and workers", () => {
  assert.equal(requireDisposableStudioExecutionEnv(safe), true);
  for (const patch of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { NODE_ENV: "development" }, { BUILD_BLOCK_ACCEPTANCE_MODE: "" },
    { TENANT_STUDIO_TRIAGE_PROOF: "" }, { TENANT_STUDIO_DRAFT_PROOF: "" },
    { TENANT_STUDIO_EXECUTION_PROOF: "" },
    { DATABASE_URL: "postgresql://prod.remote.invalid/production" },
    { APP_BASE_URL: "https://customer.example" },
    { SECURITY_SMOKE_URL: "https://customer.example" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { OPENAI_API_KEY: "real" }, { CRON_SECRET: "real" },
    { OPENAI_AUTOMATION_DRAFT_ENABLED: "true" },
    { AUTOMATION_LANGUAGE_STUDIO_ENABLED: "true" },
  ]) assert.throws(() => requireDisposableStudioExecutionEnv({ ...safe, ...patch }),
    /STUDIO_EXECUTION_REFUSED|STUDIO_DRAFT_REFUSED|STUDIO_TRIAGE_REFUSED/,
    "Unsafe profile was permitted: " + JSON.stringify(patch));
});

test("own operational case success must match real employer, source and status", () => {
  const good = response(201, {
    created: true, automationWasReplayed: false,
    operationalCase: { id: 120, organizationId: actor.org.id,
      caseType: "execution_dead_letter", sourceId: actor.failed.id,
      executionId: actor.failed.id, stepIndex: 0, status: "open" },
  });
  assert.equal(assertOwnedCase(good, actor, "open", true).id, 120);
  for (const corrupt of [
    response(200, good.json),
    response(201, { ...good.json, created: false }),
    response(201, { ...good.json, operationalCase: {
      ...good.json.operationalCase, organizationId: victim.org.id } }),
    response(201, { ...good.json, operationalCase: {
      ...good.json.operationalCase, status: "resolved" } }),
    response(201, { ...good.json, operationalCase: {
      ...good.json.operationalCase, sourceId: victim.failed.id } }),
  ]) assert.throws(() => assertOwnedCase(corrupt, actor, "open", true));
});

test("retry/replay cannot pass with a fake or foreign 200", () => {
  for (const action of ["retry", "replay"]) {
    const id = action === "replay" ? 170 : actor.failed.id;
    const good = response(action === "replay" ? 201 : 200, {
      execution: { id, organizationId: actor.org.id, employeeId: actor.worker.id,
        ruleId: actor.rule.id, status: "completed",
        result: [{ type: "revoke_sessions", stepIndex: 0, status: "completed" }] },
    });
    assert.equal(assertOwnRecovery(good, actor, action).id, id);
    for (const invalid of [
      response(200, { ok: true }),
      response(good.status, { ...good.json, execution: {
        ...good.json.execution, organizationId: victim.org.id } }),
      response(good.status, { ...good.json, execution: {
        ...good.json.execution, status: "failed" } }),
      response(good.status, { ...good.json, execution: {
        ...good.json.execution, result: [] } }),
    ]) assert.throws(() => assertOwnRecovery(invalid, actor, action));
  }
});

test("all foreign and malformed denials must hide execution/case/receipts and private markers", () => {
  assert.doesNotThrow(() => assertDeniedExecution(response(403), 403, [actor,victim], "foreign org"));
  assert.doesNotThrow(() => assertDeniedExecution(response(409), 409, [actor,victim], "foreign execution"));
  assert.doesNotThrow(() => assertDeniedExecution(response(404), 404, [actor,victim], "foreign case"));
  for (const malformed of [
    response(200, { ok: true }), response(403, { execution: { id: 15 } }),
    response(403, { operationalCase: { id: 15 } }),
    response(403, { proposalReceipt: "fake" }), response(403, { error: victim.marker }),
  ]) assert.throws(() => assertDeniedExecution(malformed, 403, [actor,victim], "bad response"));
});

test("runtime route, safe recovery and disabled language gate match audited source", () => {
  assert.equal(ROUTE, "/api/automation-studio");
  assert.equal(Object.keys(SOURCE_BLOBS).length, 2);
  for (const blob of Object.values(SOURCE_BLOBS)) assert.match(blob, /^[0-9a-f]{40}$/);
  assert.equal(verifyStudioExecutionSources(), true);
});

test("PG16 runner requires real positive operations, high IDs, negative oracle and zero credits", () => {
  const proof = readFileSync("scripts/qa/tenant-studio-execution-http.mjs", "utf8");
  const wf = readFileSync(".github/workflows/tenant-studio-execution-qa.yml", "utf8");
  assert.ok(proof.indexOf("requireDisposableStudioExecutionEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'));
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"',
    'seedEmployer("FILL" + i', 'seedEmployer("VICTIM"',
    "victim[field].id > Math.max(6, a[field].id, b[field].id)",
    "assertOwnedCase(", "assertOwnRecovery(", "await allUnchanged(",
    "ownQuarantines, 2", "ownAcknowledgements, 2", "ownRetries, 2",
    "ownResolves, 2", "ownReopens, 2", "ownReplays, 2",
    "foreignDenials, 24", "otherDenials, 20",
    "languageDraftDisabled: true", "noExternalProviderCalls: true",
    "wholePostCertified: false", "newCoverageCredits: 0",
  ]) assert.ok(proof.includes(marker), "Missing executed isolation assertion " + marker);
  for (const marker of [
    "postgres:16", "npm ci --include=dev", "npm run build",
    "node --test tests/tenant-studio-execution-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-studio-execution-http.mjs",
    "persist-credentials: false", "git rev-parse HEAD",
    'WORKER_ENABLED: "false"', 'CENTRAL_SCHEDULER_ENABLED: "false"',
    'AUTOMATION_LANGUAGE_STUDIO_ENABLED: "false"',
    'OPENAI_AUTOMATION_DRAFT_ENABLED: "false"',
  ]) assert.ok(wf.includes(marker), "Missing test runner/egress isolation " + marker);
});
