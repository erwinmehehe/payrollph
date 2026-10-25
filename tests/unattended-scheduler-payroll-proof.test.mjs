import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertDisposableProof, loopbackSchedulerTransport } from "../scripts/qa/prove-unattended-scheduler-payroll.mjs";

const localOnly = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_RUN_ID: "100",
  CI: "true",
  UNATTENDED_SCHEDULER_SYNTHETIC_PROOF: "true",
  SCHEDULER_REHEARSAL_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "true",
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  WORKER_TOKEN: "synthetic-only-32-byte-minimum-worker-key-2026",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_PAYOUTS_LIVE_APPROVED: "false",
};

test("automatic proof refuses real/prod databases, local developer and manual events", () => {
  assert.doesNotThrow(() => assertDisposableProof(localOnly));
  const variations = [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
    { CI: "false" },
    { SCHEDULER_REHEARSAL_MODE: "staging" },
    { UNATTENDED_SCHEDULER_SYNTHETIC_PROOF: "false" },
    { DATABASE_URL: "postgresql://postgres:postgres@remote.example.com:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/neondb" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require" },
    { WORKER_ENABLED: "true" },
    { CENTRAL_SCHEDULER_ENABLED: "false" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "any-key" },
    { RESEND_API_KEY: "any-key" },
    { WORKER_TOKEN: "short" },
    { VERCEL_GIT_COMMIT_SHA: "not-a-real-sha" },
  ];
  for (const variation of variations) {
    assert.throws(() => assertDisposableProof({ ...localOnly, ...variation }), "Unsafe synthetic acceptance was permitted: " + JSON.stringify(variation));
  }
});

test("test-only HTTPS origin adapter can reach ONLY two localhost routes", async () => {
  const calls = [];
  const counts = { GET: 0, POST: 0 };
  const adapter = loopbackSchedulerTransport(counts, async (url, init) => {
    calls.push({ url, method: init.method });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  });
  await adapter("https://scheduler-proof.example.test/api/jobs/dispatch-readiness", { method: "GET", redirect: "error" });
  await adapter("https://scheduler-proof.example.test/api/jobs/tick", { method: "POST", redirect: "error" });
  assert.deepEqual(calls, [
    { url: "http://127.0.0.1:3000/api/jobs/dispatch-readiness", method: "GET" },
    { url: "http://127.0.0.1:3000/api/jobs/tick", method: "POST" },
  ]);
  assert.deepEqual(counts, { GET: 1, POST: 1 });
  for (const invalid of [
    "https://real-payroll.example/api/jobs/tick",
    "https://scheduler-proof.example.test/api/other",
    "https://scheduler-proof.example.test/api/jobs/tick?token=sensitive",
    "http://scheduler-proof.example.test/api/jobs/tick",
    "https://user@scheduler-proof.example.test/api/jobs/tick",
  ]) await assert.rejects(adapter(invalid, { method: "POST", redirect: "error" }));
  await assert.rejects(adapter("https://scheduler-proof.example.test/api/jobs/tick", { method: "GET", redirect: "error" }));
  await assert.rejects(adapter("https://scheduler-proof.example.test/api/jobs/tick", { method: "POST", redirect: "follow" }));
  assert.deepEqual(counts, { GET: 1, POST: 1 });
});

test("workflow automatically provisions local Postgres and never activates a production scheduler", () => {
  const flow = readFileSync(".github/workflows/unattended-scheduler-payroll-acceptance.yml", "utf8");
  const source = readFileSync("scripts/qa/prove-unattended-scheduler-payroll.mjs", "utf8");
  assert.match(flow, /pull_request:/);
  assert.match(flow, /push:/);
  assert.doesNotMatch(flow, /^\s+workflow_dispatch:/m);
  assert.match(flow, /postgres:\s*\n\s*image: postgres:16/);
  assert.match(flow, /CENTRAL_SCHEDULER_ENABLED: "true"/);
  assert.match(flow, /WORKER_ENABLED: "false"/);
  assert.match(flow, /PAYROLL_SCHEDULER_DISPATCH_ENABLED: "false"/);
  assert.match(flow, /node scripts\/qa\/prove-unattended-scheduler-payroll\.mjs/);
  assert.match(flow, /node scripts\/qa\/apply-audit-0109-isolated\.mjs/);
  assert.match(source, /auditChainSeal\?\.sealed/);
  assert.match(source, /dispatchSchedulerTick/);
  assert.match(source, /spawn\("npm", \["run", "worker"\]/);
  assert.match(source, /stdio: \["ignore", "ignore", "ignore"\]/);
  assert.doesNotMatch(source, /openSync\(|closeSync\(|\/tmp\/payrollph-unattended-worker/);
  assert.doesNotMatch(source, /drainPayrollQueue\(|processNextPayrollJob\(|enqueuePayrollRun\(/);
  const seed = readFileSync("scripts/qa/seed-unattended-scheduler-payroll.ts", "utf8");
  assert.match(seed, /assertDisposableUnattendedSeed\(process\.env\)/);
  assert.match(seed, /env\.CENTRAL_SCHEDULER_ENABLED, "true"/);
  assert.match(seed, /env\.GITHUB_ACTIONS, "true"/);
  assert.match(seed, /target\.hostname, "127\.0\.0\.1"/);
  assert.doesNotMatch(seed, /assertIsolatedSchedulerRehearsal\(process\.env\)/);
  // The unattended seed bypasses the employee creation API. Its compensation
  // is explicit and tenant-bound before queueing; never weaken the worker's
  // read-only missing-pay-profile guard or rely on a runtime backfill.
  assert.match(seed, /db\.insert\(employeePayProfiles\)\.values\(/);
  assert.match(seed, /organizationId: org\.id,\s*employeeId: employee\.id,\s*payBasis: "monthly"/);
  assert.match(seed, /rateAmount: "30000\.00"/);
  assert.ok(seed.indexOf("await db.insert(employeePayProfiles)") < seed.indexOf("await enqueuePayrollRun(run.id)"));
  assert.match(readFileSync("src/lib/pay-basis-schema.ts", "utf8"),
    /READONLY_PAY_PROFILES_REQUIRE_REVIEWED_BACKFILL/);
  assert.match(source, /syntheticRunStatus/);
  assert.match(source, /statutoryFilingSubmitted: false/);
  assert.match(source, /actualGitHubScheduledProductionTickProven: false/);
});
