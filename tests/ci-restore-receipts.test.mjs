import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { load } from "js-yaml";
import { regressionTestArguments } from "../scripts/run-sharded-tests.mjs";

const restore = load(readFileSync(".github/workflows/full-suite-clean-vs-restored-app-db.yml", "utf8"));
const pg18 = load(readFileSync(".github/workflows/clean-pg18-source-regression.yml", "utf8"));

test("clean/restore shards preserve full comparison history for client reads and flag-off payroll parity", () => {
  const job = restore.jobs.shard;
  assert.equal(job.env.FAIL_CLOSED_GUARD_BASE_REF, "${{ github.event.pull_request.base.sha || github.event.before }}");
  const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.ok(checkout, "missing source checkout");
  assert.equal(checkout.with?.["persist-credentials"], false, "do not leave GitHub credentials available to regression tests");
  assert.equal(checkout.with?.["fetch-depth"], 0, "full git history is required by history-dependent regressions");
});

test("restore control dumps the complete reviewed baseline before either test pass", () => {
  const steps = restore.jobs.shard.steps;
  const push = steps.findIndex((s) => s.run === "npm run db:push");
  const audit = steps.findIndex((s) => s.run === "node scripts/qa/apply-audit-0109-isolated.mjs");
  const baseline = steps.findIndex((s) => s.run === "node scripts/qa/apply-isolated-baseline.mjs");
  const compare = steps.findIndex((s) => s.run?.includes('pg_dump -U postgres'));
  assert.ok(push >= 0 && audit > push && baseline > audit && compare > baseline);
  const run = steps[compare].run;
  assert.ok(run.indexOf('pg_dump -U postgres') < run.indexOf('clean.tap'));
  assert.ok(run.indexOf('pg_restore -U postgres') < run.indexOf('restored.tap'));
  assert.match(run, /if\(clean.exit!==0\|\|restored.exit!==0\)process.exitCode=1/);
});

test("both machine-readable collectors explicitly request TAP from the full shard runner", () => {
  const restoring = restore.jobs.shard;
  assert.equal(restoring.env.REGRESSION_TEST_REPORTER, "tap");
  const step = pg18.jobs.regression.steps.find((s) => s.run?.includes("node scripts/run-sharded-tests.mjs"));
  assert.equal(step.env.REGRESSION_TEST_REPORTER, "tap");
});

test("real failing TAP reaches the actual restore receipt parser without exposing assertion diagnostics", () => {
  const root = mkdtempSync(join(tmpdir(), "fictional-restore-receipt-"));
  try {
    const file = join(root, "probe.test.mjs");
    writeFileSync(file, 'import test from "node:test"; import assert from "node:assert/strict"; test("fictional labelled failure", () => assert.fail("PRIVATE_DIAGNOSTIC_DO_NOT_UPLOAD"));');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // Launch an independent CLI runner, not a nested child of this test.
    const result = spawnSync(process.execPath, regressionTestArguments([file], "tap"), { encoding: "utf8", env });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /not ok 1 - fictional labelled failure/);
    const run = restore.jobs.shard.steps.find((s) => s.run?.includes("RECOVERED_APP_DB_FULL_SUITE")).run;
    const script = run.split("node <<'JS'\n")[1].split("\nJS")[0];
    let receipt;
    const failed = (clean, restored) => {
      const processStub = { env: { CLEAN_EXIT: String(clean), RESTORED_EXIT: String(restored), SOURCE_TABLES: "1", SOURCE_FKS: "0", GITHUB_SHA: "fictional-source", SHARD_INDEX: "0" } };
      vm.runInNewContext(script, { process: processStub, console: { log() {} }, require: () => ({
        readFileSync: (path) => path.endsWith("clean.tap") && clean === 0 ? "TAP version 13\n1..0\n" : path.endsWith("restored.tap") && restored === 0 ? "TAP version 13\n1..0\n" : result.stdout,
        writeFileSync: (_path, text) => { receipt = JSON.parse(text); },
      }) });
      return processStub.exitCode;
    };
    assert.equal(failed(0, 1), 1);
    assert.deepEqual(receipt.recoveredOnly, ["fictional labelled failure"]);
    assert.ok(!JSON.stringify(receipt).includes("PRIVATE_DIAGNOSTIC_DO_NOT_UPLOAD"));
    assert.equal(failed(1, 0), 1);
    assert.deepEqual(receipt.cleanOnly, ["fictional labelled failure"]);
    assert.equal(failed(1, 1), 1);
    assert.deepEqual(receipt.shared, ["fictional labelled failure"]);
    assert.equal(failed(0, 0), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
