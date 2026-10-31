import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BATCH2_METHODS, requireDisposableWrk02Batch2,
  assertDeniedPlanning, assertStoredOwnedPlanning, assertPlanningUnchanged,
} from "../scripts/qa/tenant-wrk02-batch2-contract.mjs";

const files = [
  ["src/app/api/workforce-planning/baselines/route.ts",
    "21a1b50f86b3882fc11910e45bcd81e403662012"],
  ["src/app/api/workforce-planning/position-executions/route.ts",
    "142797be0cfa4f64849b20958869c12147ccf792"],
];
const gitBlobSha = content => createHash("sha1")
  .update("blob " + Buffer.byteLength(content) + "\0")
  .update(content).digest("hex");
const runner = readFileSync("scripts/qa/tenant-wrk02-batch2-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-wrk02-batch2-http.yml", "utf8");

test("Only the three uncredited Batch 2 methods are in scope, with exact existing routes", () => {
  assert.deepEqual(BATCH2_METHODS, [
    "src/app/api/workforce-planning/baselines/route.ts POST",
    "src/app/api/workforce-planning/position-executions/route.ts POST",
    "src/app/api/workforce-planning/position-executions/route.ts PATCH",
  ]);
  for (const [path, sha] of files) {
    assert.equal(gitBlobSha(readFileSync(path, "utf8")), sha,
      "Batch 2 source changed: rerun independent source and tenant review " + path);
  }
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  for (const key of BATCH2_METHODS) {
    const path = key.slice(0, key.lastIndexOf(" "));
    const name = key.slice(key.lastIndexOf(" ") + 1);
    const method = manifest.allApiRouteFiles[path]?.methods.find(x => x.name === name);
    assert.equal(method?.status, "GAP", key + " cannot be promoted on unrun proof");
    assert.equal(method?.testedBy, null, key + " has no independently accepted evidence yet");
  }
});

test("Server-side plan/role gates, scoped SQL and execution locks are retained", () => {
  const baseline = readFileSync(files[0][0], "utf8");
  const execution = readFileSync(files[1][0], "utf8");
  const basePost = baseline.slice(baseline.indexOf("export async function POST("));
  assert.ok(basePost.indexOf("await getAccess(user.id, scenario.organizationId)") <
    basePost.indexOf('if (scenario.status !== "approved")'));
  for (const item of [
    "eq(workforcePlans.organizationId, scenario.organizationId)",
    "eq(workforcePlanBaselines.organizationId, scenario.organizationId)",
    "eq(workforcePlanBaselines.scenarioId, scenario.id)",
    "select id from workforce_plans where id = ${plan.id} for update",
    'if (existing) throw new Error("SCENARIO_ALREADY_PUBLISHED")',
  ]) assert.ok(basePost.includes(item), "Baseline guard missing " + item);
  for (const item of [
    "companyWidePeopleAdmin(user.id, organizationId)",
    "eq(workforcePlans.organizationId, organizationId)",
    "eq(workforcePlanBaselines.organizationId, organizationId)",
    "eq(workforcePlanPositionExecutions.organizationId, organizationId)",
    "eq(workforcePlanPositionExecutions.executionHash, executionHash)",
    'eq(workforcePlanPositionExecutions.status, "cancelled")',
    "companyWidePeopleAdmin(user.id, execution.organizationId)",
    "eq(workforcePlanPositionExecutions.organizationId, execution.organizationId)",
    'eq(workforcePlanPositionExecutions.status, "preview")',
    "pg_advisory_xact_lock(4194, ${execution.planId})",
    "freshExecution.baselineSnapshotHash !== execution.baselineSnapshotHash",
    'if (!plan || plan.status !== "published" || !baseline?.current)',
    "baseline.snapshotHash !== freshExecution.baselineSnapshotHash",
    "hash(evidence) !== freshExecution.executionHash",
    "eq(positions.organizationId, freshExecution.organizationId)",
  ]) assert.ok(execution.includes(item), "Position execution guard missing " + item);
});

test("Disposable environment refuses real database, provider, worker and non-CI", () => {
  const good = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_WRK02_BATCH2_MODE: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  };
  assert.doesNotThrow(() => requireDisposableWrk02Batch2(good));
  for (const [key, val] of [
    ["DATABASE_URL", "postgresql://postgres:postgres@db.internal/payroll"],
    ["SECURITY_SMOKE_URL", "https://real-payroll.example.invalid"],
    ["GITHUB_ACTIONS", "false"],
    ["CI", "false"],
    ["NODE_ENV", "development"],
    ["TENANT_WRK02_BATCH2_MODE", "production"],
    ["WORKER_ENABLED", "true"],
    ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"],
    ["XENDIT_SECRET_KEY", "test-nonempty"],
    ["PAYMONGO_SECRET_KEY", "test-nonempty"],
    ["NEON_DATABASE_URL", "postgresql://example.invalid/prod"],
  ]) assert.throws(() => requireDisposableWrk02Batch2({ ...good, [key]: val }),
    key + " cannot run synthetic batch2");
  assert.ok(runner.indexOf("requireDisposableWrk02Batch2();") <
    runner.indexOf('import("../../src/db/index.ts")'),
  "Environment guard must run before dynamic database import");
});

test("Real HTTP proof demands owned 201s, victim 403/404, race and nonmutating stale 409", () => {
  for (const marker of [
    'seedEmployer("ATTA"',
    'seedEmployer("ATTB"',
    'seedEmployer("VICTIM"',
    "for (const actor of [a, b])",
    "victim.seed.scenario.id >",
    "victim.baseline.id >",
    "victim.execution.id >",
    "assertStoredOwnedPlanning(response, row",
    'await request(BASELINE, { method: "POST"',
    "const racing = await Promise.all(",
    "racing.map(x => x.status).sort((x, y) => x - y), [201, 409]",
    "assert.equal(alphaAll.length, 1",
    "await denied(EXECUTION",
    'for (const action of ["cancel", "apply"])',
    "assert.equal(reopened.json?.reopened, true)",
    "aApply.json?.execution?.result?.updatedPositions?.length, 1",
    "stalePublishedBaselineApply409: true",
    "await unchangedAll(beforeStale",
    "assert.equal(betaPosition.status, \"approved\")",
    "assert.equal(revoke.length, 1)",
    "stillSignedInAfterMembershipRevocation: true",
    "unitScopedPeopleHrWritesDenied: 3",
    "activeOwnerWithoutPeoplePermissionDenied: 3",
    'permissions: ["workforce.manage"]',
    "unit-scoped People HR is not company-wide",
    "active owner denied by people.admin permission overlay",
    "assertPlanningUnchanged(victimBefore, await snapshot(victim.org.id)",
    "manifestMethodCredits: 0",
    "productionCertified: false",
  ]) assert.ok(runner.includes(marker), "Batch2 evidence lost negative control: " + marker);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-wrk02-batch2-http\.mjs/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.ok(workflow.includes("npm run db:push"));
  assert.ok(workflow.includes("npm run build"));
  assert.ok(workflow.includes("npm start -- -H 127.0.0.1"));
  assert.doesNotMatch(workflow, /deploy|neonctl|PAYROLL_RELEASE_ENABLED: "true"/i,
    "No live deployment or release in this test");
});

test("Denial/positive contract cannot accept empty success or data movement", () => {
  assert.throws(() => assertDeniedPlanning({
    status: 403, json: { execution: { id: 42 }, error: "Access denied" },
    text: "Access denied",
  }, 403), /must|undefined/i);
  assert.throws(() => assertStoredOwnedPlanning({
    status: 201, json: { baseline: { id: 1, organizationId: 12 } },
    text: "created",
  }, { id: 2, organizationId: 12 }, {
    method: "baseline", organizationId: 12,
  }), /actual|reference|equal|ID|SQL/i);
  assert.throws(() => assertPlanningUnchanged({ victim: true }, { victim: false },
    "cross-company 403"), /unchanged|foreign|must leave|deep-equal/i);
});
