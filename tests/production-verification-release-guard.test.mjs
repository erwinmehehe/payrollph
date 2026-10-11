import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readinessWorkflow = readFileSync(".github/workflows/production-rollout-readiness.yml", "utf8");
const rbacWorkflow = readFileSync(".github/workflows/live-rbac-sandbox-smoke.yml", "utf8");
const probe = readFileSync("scripts/live-production-readiness.ts", "utf8");

test("protected verifier secret cannot leak into dependency installation or job-wide environment", () => {
  for (const yaml of [readinessWorkflow, rbacWorkflow]) {
    assert.ok(!yaml.split("    steps:")[0].includes("PRODUCTION_READINESS_TOKEN:"),
      "Production verifier must not be scoped to all steps.");
    assert.match(yaml, /PRODUCTION_READINESS_TOKEN: \\$\\{\\{ secrets\\.PRODUCTION_READINESS_TOKEN \\}\\}/);
    assert.match(yaml, /Production verification blocked|Production RBAC verification blocked/);
    assert.match(yaml, /if \\[ "\\$\\{#PRODUCTION_READINESS_TOKEN\\}" -lt 32 \\]/);
  }
  assert.ok(readinessWorkflow.indexOf("Preflight protected production verification") < readinessWorkflow.indexOf("- run: npm ci"),
    "Stop before installing dependencies when release credential is absent.");
  assert.ok(readinessWorkflow.includes("name: Verify live production rollout"));
  assert.ok(readinessWorkflow.includes("run: npx tsx scripts/live-production-readiness.ts"));
});

test("private release probe fails before querying public aliases on absent secret or invalid commit", () => {
  assert.ok(probe.includes('blocked: "missing-protected-verification-credential"'));
  assert.ok(probe.includes('blocked: "missing-or-invalid-exact-commit-sha"'));
  assert.ok(probe.includes('if (token.length < 32)'));
  const main = probe.indexOf("async function main()");
  assert.ok(main > 0);
  const guard = probe.indexOf("if (token.length < 32)", main);
  const wait = probe.indexOf("await waitForExpectedDeployment()", main);
  const surface = probe.indexOf('await waitForSurface("/"', main);
  assert.ok(guard > main && wait > guard && surface > wait,
    "Check credentials and exact deployment before public health surfaces.");
  assert.ok(probe.includes('externalCertification: "not-assessed-by-live-readiness-probe"'));
  assert.ok(probe.includes("gaApproved: false"));
});

test("official filing remediation never labels a draft worksheet a certified portal upload", () => {
  assert.ok(probe.includes("PayrollPH source worksheets are not certified DAT files."));
  assert.ok(probe.includes("PayrollPH R-3 CSV is only a reconciliation worksheet."));
  assert.ok(probe.includes("RF-1 draft is not certified as a portal upload."));
  assert.ok(probe.includes("MCRF worksheet must not be represented as a certified eSRS MSRF import."));
});
