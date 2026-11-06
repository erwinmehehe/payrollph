import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runner = readFileSync("scripts/qa/tenant-managed-client-approval-http.mjs", "utf8");
test("managed approval proof refuses execution before loading the database outside disposable CI", () => {
  const result = spawnSync(process.execPath, ["scripts/qa/tenant-managed-client-approval-http.mjs"], {
    encoding: "utf8", env: { ...process.env, CI: "false", GITHUB_ACTIONS: "false" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PII_APPROVAL_REFUSED: CI/);
  assert.ok(runner.indexOf("requireDisposablePiiApprovalEnv();") < runner.indexOf('import("../../src/db/index.ts")'));
});
test("approval proof is wired to existing production-Next PG16 acceptance without coverage changes", () => {
  const workflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
  assert.ok(workflow.includes("run: npx tsx scripts/qa/tenant-managed-client-approval-http.mjs"));
  assert.ok(runner.includes("newCoverageCredits: 0"));
  assert.ok(!runner.includes("tenant-isolation-coverage-manifest.json"));
});
test("approval proof distinguishes persisted own approval, reapproval, victim denial, concurrency and audit rollback", () => {
  for (const required of [
    "for (const f of [a, b])", "victim.run.id > 6", "foreign.text, missing.text",
    "after.approvals.length, 1", "after.audit.at(-1).metadata.approvalId",
    "reapproved.approvals[0].payrollFingerprint, after.approvals[0].payrollFingerprint",
    "accepts another employer's data", "clientApproverUserId: f.checker.id",
    "wait_event_type='Lock'", "membership revocation race was not actually exercised",
    "approval committed despite audit failure", "DROP TRIGGER IF EXISTS",
    "assert.deepEqual(await snapshot(victim), victimBefore)",
  ]) assert.ok(runner.includes(required), required);
});
