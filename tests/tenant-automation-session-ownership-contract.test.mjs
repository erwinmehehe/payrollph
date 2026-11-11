import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposable } from "../scripts/qa/tenant-automation-session-ownership-http.mjs";

const origin = "http://127.0.0.1:3000";
const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_SESSION_OWNERSHIP_PROOF: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: origin, SECURITY_SMOKE_URL: origin, TRUSTED_APP_ORIGINS: origin,
  DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", AUTOMATION_LANGUAGE_STUDIO_ENABLED: "false",
  OPENAI_AUTOMATION_DRAFT_ENABLED: "false", REQUIRE_PRIVILEGED_MFA: "true",
};
test("proof rejects external DB, live worker, provider and production profiles", () => {
  assert.equal(requireDisposable(safe), true);
  for (const patch of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { DATABASE_URL: "postgresql://example.com/prod" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/production" },
    { APP_BASE_URL: "https://example.com" }, { SECURITY_SMOKE_URL: "https://example.com" },
    { WORKER_ENABLED: "true" }, { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { AUTOMATION_LANGUAGE_STUDIO_ENABLED: "true" },
    { OPENAI_API_KEY: "invalid-test-secret" },
  ]) assert.throws(() => requireDisposable({ ...safe, ...patch }), /SESSION_PROOF_REFUSED/);
});
test("both separation actions call scoped login ownership and guard account-wide sessions", () => {
  const engine = readFileSync("src/lib/automation.ts", "utf8");
  const boundary = readFileSync("src/lib/automation-employee-account-boundary.ts", "utf8");
  assert.equal((engine.match(/tenantLinkedEmployeeAccounts\(input\.organizationId, employeeId\)/g) ?? []).length, 2);
  assert.equal((engine.match(/noOtherActiveEmployerMembership\(linkedUser\.id, input\.organizationId\)/g) ?? []).length, 2);
  const separated = engine.slice(engine.indexOf('if (action.type === "revoke_sessions")'),
    engine.indexOf('if (action.type === "request_payroll_adjustment")'));
  assert.doesNotMatch(separated, /\.from\(users\)\.where\(eq\(users\.employeeId, employeeId\)\)/);
  assert.match(boundary, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(boundary, /eq\(userOrganizations\.organizationId, organizationId\)/);
  assert.match(boundary, /eq\(userOrganizations\.active, true\)/);
  assert.match(boundary, /ne\(userOrganizations\.organizationId, organizationId\)/);
  assert.match(boundary, /NOT EXISTS/);
  assert.match(engine, /sharedLoginSessionsPreserved/);
  assert.match(engine, /another active employer/);
});
test("real HTTP fixture contains own and shared success plus immutable foreign-state assertions", () => {
  const proof = readFileSync("scripts/qa/tenant-automation-session-ownership-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-automation-session-ownership.yml", "utf8");
  for (const token of [
    "seedEmployer(\"OWN\"", "seedEmployer(\"PEER\"", "seedEmployer(\"VICTIM\"",
    'post("retry-execution-step"', 'post("replay-execution"',
    'failedExecution("deactivate_access"',
    "snapshotForeign()", "sharedLoginSessionsPreserved", "newMethodCredits: 0",
    "productionAccepted: false", "requireDisposable();",
  ]) assert.ok(proof.includes(token), "Missing proof assertion: " + token);
  assert.ok(proof.indexOf("requireDisposable();") < proof.indexOf('import("../../src/db/index.ts")'));
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-automation-session-ownership-http\.mjs/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /pull_request\.head\.sha \|\| github\.sha/);
  assert.doesNotMatch(workflow, /secrets\.|continue-on-error/);
});
