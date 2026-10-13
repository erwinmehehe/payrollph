import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/scheduler-postgres-rehearsal.yml", "utf8");
const bootstrap = readFileSync("scripts/qa/bootstrap-scheduler-rehearsal-db.ts", "utf8");
const guard = readFileSync("tests/helpers/scheduler-isolated-guard.ts", "utf8");

test("PostgreSQL acceptance stays isolated, disposable, and deactivated", () => {
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.match(workflow, /SCHEDULER_REHEARSAL_MODE: isolated-ci-only/);
  assert.match(workflow, /CENTRAL_SCHEDULER_ENABLED: "false"/);
  assert.match(workflow, /WORKER_ENABLED: "false"/);
  assert.match(workflow, /PAYROLL_SCHEDULER_DISPATCH_ENABLED: "false"/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.match(workflow, /permissions:\s*\n  contents: read/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /environment: payroll-scheduler-production/);
  assert.doesNotMatch(workflow, /PAYROLL_SCHEDULER_DISPATCH_ENABLED: "true"/);
  assert.match(guard, /url\.hostname !== "127\.0\.0\.1"/);
  assert.match(guard, /url\.pathname !== "\/app_db"/);
  assert.match(bootstrap, /assertIsolatedSchedulerRehearsal\(process\.env\)/);
  assert.match(bootstrap, /CREATE TABLE scheduler_state/);
  assert.doesNotMatch(bootstrap, /db:push|CREATE TABLE employees|INSERT INTO employees/);
});

test("rehearsal exercises actual independent child processes and fenced receipts", () => {
  assert.match(workflow, /tests\/scheduler-lease\.test\.ts/);
  assert.match(workflow, /tests\/scheduler-process-recovery\.test\.ts/);
  assert.match(workflow, /tests\/scheduler-activation\.test\.ts/);
  const processTest = readFileSync("tests/scheduler-process-recovery.test.ts", "utf8");
  assert.match(processTest, /Promise\.all\(/);
  assert.match(processTest, /child\.kill\("SIGKILL"\)/);
  assert.match(processTest, /recordSchedulerCompletion|perform\("receipt"/);
  assert.match(processTest, /"isolated-ci-only"/);
  assert.match(workflow, /bootstrap-scheduler-rehearsal-db\.ts verify/);
});
