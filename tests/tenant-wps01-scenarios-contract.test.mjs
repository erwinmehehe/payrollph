import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  WPS01_METHOD, WPS01_ROUTE, WPS01_SOURCE_BLOB, requireDisposableWps01,
  assertWps01Created, assertWps01Denied, assertWps01Unchanged,
} from "../scripts/qa/tenant-wps01-scenarios-contract.mjs";

const runnerPath = "scripts/qa/tenant-wps01-scenarios-http.mjs";
const workflowPath = ".github/workflows/tenant-wps01-scenarios-http.yml";
function gitBlobSha(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return createHash("sha1").update("blob " + bytes.length)
    .update(Buffer.from([0])).update(bytes).digest("hex");
}
const safeEnv = () => ({
  GITHUB_ACTIONS: "true", CI: "true",
  TENANT_WPS01_MODE: "fictional-pg16-http",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: "https://payroll.example.test",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "",
  XENDIT_PAYOUT_SECRET_KEY: "", RESEND_API_KEY: "",
  POSTMARK_SERVER_TOKEN: "", SMTP_URL: "", STRIPE_SECRET_KEY: "",
});

test("WPS-01 refuses any provider-enabled, external or non-CI environment BEFORE DB import", () => {
  assert.equal(requireDisposableWps01(safeEnv()), true);
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"], ["CI", "false"],
    ["TENANT_WPS01_MODE", ""], ["TENANT_SECOND_PASS_MODE", ""],
    ["NODE_ENV", "development"], ["DEMO_MODE", "true"],
    ["SECURITY_SMOKE_URL", "https://example.com:3000"],
    ["SECURITY_SMOKE_URL", "http://localhost:3000"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.private:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/prod"],
    ["APP_BASE_URL", "https://example.com"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"], ["XENDIT_BILLING_ENABLED", "true"],
    ["WORKER_ENABLED", "true"], ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["XENDIT_SECRET_KEY", "live-key"], ["RESEND_API_KEY", "live-key"],
    ["POSTMARK_SERVER_TOKEN", "live-key"], ["SMTP_URL", "smtp://external"],
    ["STRIPE_SECRET_KEY", "live-key"],
  ]) {
    assert.throws(() => requireDisposableWps01({ ...safeEnv(), [key]: value }),
      /WPS01_REFUSED/, "fail closed for " + key + "=" + value);
  }
  assert.throws(() => requireDisposableWps01({}), /WPS01_REFUSED/);
});

test("actual WPS-01 runner proves separate positive, real victim and same-shape absence denials", () => {
  const source = readFileSync(runnerPath, "utf8");
  assert.ok(source.indexOf("requireDisposableWps01();") <
    source.indexOf('import("../../src/db/index.ts")'),
    "disposable guard MUST happen before importing DB or shared fixture");
  assert.ok(source.indexOf("requireDisposableWps01();") <
    source.indexOf('import("./tenant-table-http.mjs")'),
    "shared table module must be imported only after the new independent guard");
  for (const proof of [
    "SHOW server_version_num", '"ATTA"', '"ATTB"', '"VICTIM"',
    "victim[field].id > a[field].id",
    "victimPlan.id > plans.get(a.org.id).id",
    "realVictim.id > firstA.id",
    "realVictim.id > firstB.id",
    "standaloneRequest(PATH, { method: \"POST\"",
    "assertWps01Created(response, added[0]",
    "metadata?.scenarioId",
    "assertWps01Unchanged(before, await allStates()",
    "organizationId: victim.org.id, planId: victimPlan.id",
    "planId: victimPlan.id",
    "planId: 2147483647",
    "scopeOrgUnitId: victim.unit.id",
    "scopeOrgUnitId: 2147483647",
    "assert.deepEqual(foreignPlan.json, missingPlan.json",
    "assert.deepEqual(foreignUnit.json, missingUnit.json",
    "scopeOrgUnitId: attacker.unit.id",
    "scenarioVersionHistoryImmutable: true",
    "active: false", "revoked original employer membership",
    "assert.equal(createdOwn, 7", "assert.equal(denied, 12",
    "newCoverageCredits: 0", "independentSecurityReview: \"PENDING\"",
  ]) assert.ok(source.includes(proof), "WPS-01 missing an actual HTTP or SQL check: " + proof);
  assert.doesNotMatch(source, /(?:https?:\/\/)(?!127\.0\.0\.1)[a-z0-9.-]+/i,
    "runner must not contact any external HTTP host");
});

test("WPS-01 contract refuses wrong own data, leakage and mutated victim state", () => {
  const row = {
    id: 42, organizationId: 12, createdByUserId: 3,
    planId: 9, version: 1, status: "draft", snapshotHash: "a".repeat(64),
  };
  const employer = { org: { id: 12 }, owner: { id: 3 } };
  const ok = { status: 201, json: { scenario: { id: 42, organizationId: 12 } } };
  assert.equal(assertWps01Created(ok, row, employer, { id: 9 }, 1).id, 42);
  assert.throws(() => assertWps01Created(ok, { ...row, organizationId: 77 },
    employer, { id: 9 }, 1), /foreign/);
  assert.throws(() => assertWps01Created(ok, { ...row, version: 2 },
    employer, { id: 9 }, 1), /version/);
  const denied = { status: 403, json: { error: "Access denied" },
    text: '{"error":"Access denied"}', headers: new Headers() };
  assert.deepEqual(assertWps01Denied(denied, 403, ["VICTIM-SECRET"]), denied.json);
  assert.throws(() => assertWps01Denied({ ...denied, text: "VICTIM-SECRET" },
    403, ["VICTIM-SECRET"]), /leaked/);
  assert.throws(() => assertWps01Denied({ ...denied, status: 200 }, 403),
    /denial status/);
  assert.throws(() => assertWps01Unchanged({ victim: [1] }, { victim: [2] }, "victim"),
    /denial changed/);
});

test("WPS-01 never reclassifies the canonical workforce scenario POST GAP", () => {
  const route = readFileSync(WPS01_ROUTE);
  assert.equal(gitBlobSha(route), WPS01_SOURCE_BLOB,
    "production scenario route changed; WPS-01 must be independently re-reviewed");
  const source = route.toString();
  for (const safeguard of [
    "enforceSameOriginMutation(request)", "getSessionUser()",
    "assertOrganizationRole(", "workforceAccess(user.id, organizationId)", "getAccess(userId, organizationId)",
    "eq(workforcePlans.organizationId, organizationId)",
    "eq(orgUnits.organizationId, organizationId)",
    "db.transaction(async (tx) =>",
    '"Workforce staffing scenario saved"',
    '"Scenario could not be calculated."',
  ]) assert.ok(source.includes(safeguard), "source boundary missing: " + safeguard);
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json"));
  const method = manifest.allApiRouteFiles[WPS01_ROUTE]?.methods?.find(x => x.name === "POST");
  assert.equal(WPS01_METHOD, "POST workforce-planning/scenarios");
  assert.equal(method?.status, "GAP",
    "a PR with no completed independent HTTP evidence may not claim a method credit");
  assert.equal(method?.testedBy, null,
    "do not borrow a different shared-family proof for WPS-01");
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
});

test("WPS-01 workflow is an isolated, no-money PG16 job and does not alter production routes", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  for (const token of [
    "postgres:16", "npm ci", "npm run db:push",
    "node scripts/qa/apply-isolated-baseline.mjs", "npm run build",
    "npm start -- -H 127.0.0.1", "tenant-wps01-scenarios-http.mjs",
    "tenant-wps01-scenarios-contract.test.mjs",
    "TENANT_WPS01_MODE", "PAYMONGO_DISBURSEMENTS_ENABLED: 'false'",
    "XENDIT_PAYOUTS_ENABLED: 'false'", "XENDIT_BILLING_ENABLED: 'false'",
    "WORKER_ENABLED: 'false'", "CENTRAL_SCHEDULER_ENABLED: 'false'",
    "RESEND_API_KEY: ''", "POSTMARK_SERVER_TOKEN: ''",
    "permissions:", "contents: read", "persist-credentials: false",
  ]) assert.ok(workflow.includes(token), "WPS-01 workflow missing guard: " + token);
  assert.ok(!workflow.includes("workflow_dispatch:"),
    "no manual job should silently accept arbitrary database targets");
});
