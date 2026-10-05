import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("production workflows use payrollsoftware.ph instead of the Vercel hostname", () => {
  const paths = [
    ".github/workflows/bootstrap-production-security.yml",
    ".github/workflows/live-rbac-sandbox-smoke.yml",
    ".github/workflows/production-bank-encryption.yml",
    ".github/workflows/production-rollout-readiness.yml",
  ];

  for (const path of paths) {
    const source = read(path);
    assert.ok(source.includes("https://payrollsoftware.ph"), `${path} must target the production domain`);
    assert.ok(!source.includes("erwinmehehe-payrollph.vercel.app"), `${path} must not target the Vercel hostname`);
  }
});

test("production pilot QA cancels superseded commits on the same PR or branch", () => {
  const source = read(".github/workflows/pilot-payroll-qa.yml");
  assert.ok(source.includes("concurrency:"), "pilot QA must define a concurrency group");
  assert.ok(source.includes("github.event.pull_request.number || github.ref"), "pilot QA concurrency must scope to the PR or branch");
  assert.ok(source.includes("cancel-in-progress: true"), "pilot QA must cancel stale runs");
});
