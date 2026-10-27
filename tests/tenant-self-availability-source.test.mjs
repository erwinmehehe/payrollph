import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proofFile = "scripts/qa/tenant-self-availability-http.mjs";
const workflowFile = ".github/workflows/security-http-smoke.yml";
const runnerFile = "scripts/qa/tenant-second-pass-http.mjs";
const routeFile = "src/app/api/self/availability/route.ts";
const manifestFile = "scripts/qa/tenant-isolation-coverage-manifest.json";
const read = file => readFileSync(file, "utf8");

test("WRK-01 availability proof pins two exact uncredited API methods", () => {
  const manifest = JSON.parse(read(manifestFile));
  const route = manifest.allApiRouteFiles[routeFile];
  assert.ok(route && route.route === "self/availability");
  for (const method of ["GET", "POST"]) {
    const row = route.methods.find(entry => entry.name === method);
    assert.equal(row?.status, "GAP",
      "a proof PR must not promote shared method credit before exact-head and owner review");
  }
  assert.equal(route.methods.length, 2);
  const proof = read(proofFile);
  assert.match(proof, /"GET \/api\/self\/availability", "POST \/api\/self\/availability"/);
  assert.match(proof, /creditPromoted: false/);
});

test("WRK-01 availability has positive owned HTTP writes and genuinely persisted victim IDs", () => {
  const code = read(proofFile);
  assert.match(code, /victimTarget\.id > 6/);
  assert.match(code, /ownRows\.every\(row => victimTarget\.id > row\.id\)/);
  assert.match(code, /real persisted victim-only rule/);
  assert.match(code, /populated\.json\?\.rules\?\.some/);
  assert.match(code, /saved\.json\?\.saved, true/);
  assert.match(code, /stored\?\.organizationId, a\.org\.id/);
  assert.match(code, /stored\?\.employeeId, a\.worker\.id/);
  assert.match(code, /delete_future_rule/);
  assert.match(code, /Employee WFM availability preference created/);
  assert.match(code, /Employee WFM availability preference withdrawn/);
  assert.match(code, /assert\.deepEqual\(await snapshot\(victim\.org\.id\), victimBefore/);
  assert.match(code, /GET must reject actual victim employer and employee selectors/);
  assert.match(code, /POST cannot remove a real other-employer higher-ID rule/);
  assert.match(code, /revoked original employer membership denies previously owned GET/);
  assert.match(code, /revoked original employer membership denies previously owned POST/);
  assert.match(code, /other active membership keeps the exact original session authenticated/);
});

test("WRK-01 availability test has strict fictional PG16, CI and no-money guards", () => {
  const proof = read(proofFile);
  for (const literal of [
    'process.env.GITHUB_ACTIONS, "true"',
    'process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"',
    'process.env.TENANT_SELF_AVAILABILITY_PROOF, "isolated-ci-only"',
    'process.env.WFM_EMPLOYEE_AVAILABILITY_ENABLED, "true"',
    '"http://127.0.0.1:3000/"',
    '"postgresql://postgres:postgres@127.0.0.1:5432/app_db"',
    '"PAYMONGO_DISBURSEMENTS_ENABLED"',
    '"XENDIT_PAYOUTS_ENABLED"',
    '"PAYMONGO_SECRET_KEY"',
    '"XENDIT_SECRET_KEY"',
  ]) assert.ok(proof.includes(literal), "missing bounded proof guard: " + literal);
  assert.match(proof, /payrollMutated: false/);
  assert.match(proof, /rosterPublished: false/);
  assert.match(proof, /productionTested: false/);
});

test("WRK-01 availability server gate and runner opt-in remain isolated to Security HTTP Smoke", () => {
  const workflow = read(workflowFile);
  const runner = read(runnerFile);
  const serverStep = workflow.indexOf("- name: Start production server");
  const proofStep = workflow.indexOf("- name: Real-HTTP second-pass tenant isolation");
  assert.ok(serverStep > 0 && proofStep > serverStep);
  assert.match(workflow.slice(serverStep, proofStep),
    /WFM_EMPLOYEE_AVAILABILITY_ENABLED: "true"/);
  const stage = workflow.slice(proofStep, workflow.indexOf("- name: Show server log", proofStep));
  assert.match(stage, /TENANT_SELF_AVAILABILITY_PROOF: isolated-ci-only/);
  assert.match(stage, /WFM_EMPLOYEE_AVAILABILITY_ENABLED: "true"/);
  assert.match(stage, /npx tsx scripts\/qa\/tenant-second-pass-http\.mjs/);
  assert.doesNotMatch(workflow.slice(0, serverStep),
    /WFM_EMPLOYEE_AVAILABILITY_ENABLED: "true"/,
    "availability must not be activated for unrelated CI steps");
  assert.match(runner, /tenant-self-availability-http\.mjs/);
  assert.match(runner, /verifySelfAvailabilityIsolation/);
  assert.match(workflow, /node --check scripts\/qa\/tenant-self-availability-http\.mjs/);
  assert.match(workflow, /node --test tests\/tenant-self-availability-source\.test\.mjs/);
});
