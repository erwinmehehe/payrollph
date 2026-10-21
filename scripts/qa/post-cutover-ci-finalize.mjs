#!/usr/bin/env node
// Runs even when npm, cutover or HTTP smoke fails. Reports only step states and
// allowlisted assertion labels; raw server/pg logs and credentials are excluded.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("CI_FINALIZER_DISPOSABLE_ACTIONS_ONLY");
}
const expected = [
  ["npm ci", "SMOKE_STEP_NPM_CI"],
  ["tsc --noEmit", "SMOKE_STEP_TSC"],
  ["lint", "SMOKE_STEP_LINT"],
  ["npm test", "SMOKE_STEP_NPM_TEST"],
  ["exact cutover runner", "SMOKE_STEP_CUTOVER"],
  ["restricted-role payroll journey", "SMOKE_STEP_JOURNEY"],
  ["app restart and persistence", "SMOKE_STEP_RESTART"],
];
const read = (path) => {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed?.checks && Array.isArray(parsed.checks) ? parsed : null;
  } catch { return null; }
};
const initial = read("qa-artifacts/post-cutover-smoke/ci-report.json");
const restarted = read("qa-artifacts/post-cutover-smoke/restart-report.json");
const status = value => value === "success" ? "PASS" : "FAIL";
const checks = expected.map(([name, envKey]) => {
  const outcome = process.env[envKey] ?? "not_run";
  return { name, status: status(outcome),
    ...(outcome !== "success"
      ? { assertion: `WORKFLOW_${name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_${outcome.toUpperCase()}` }
      : {}),
  };
});
const report = { kind: "post-cutover-ci-workflow", version: 1,
  commitSha: process.env.GITHUB_SHA ?? null,
  checks, passed: checks.filter(x => x.status === "PASS").length,
  failed: checks.filter(x => x.status === "FAIL").length,
  realRoleProofs: initial?.checks?.filter(c => c.name.includes("role") || c.name.includes("privilege")) ?? [],
  payrollChecks: initial?.checks?.length ?? 0,
  restartChecks: restarted?.checks?.length ?? 0,
  liveDatabaseTouched: false, providerCalls: 0, ownerApproval: false };
mkdirSync("qa-artifacts/post-cutover-smoke", { recursive: true });
writeFileSync("qa-artifacts/post-cutover-smoke/workflow-report.json",
  JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
const rows = [
  "## Post-cutover CI pipeline (disposable PG18 only)",
  "",
  "| Check | PASS / FAIL | Exact assertion |", "| --- | --- | --- |",
  ...checks.map(c => `| ${c.name} | ${c.status} | ${c.assertion ?? "—"} |`),
  "",
  `Detailed app/role checks: ${initial ? initial.passed + " PASS, " + initial.failed + " FAIL" : "not reached"}`,
  `Post-restart checks: ${restarted ? restarted.passed + " PASS, " + restarted.failed + " FAIL" : "not reached"}`,
  "",
  "No Neon database, production application environment or provider credentials are configured in this job.",
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows);
process.stdout.write(JSON.stringify({ kind: report.kind, passed: report.passed,
  failed: report.failed, checks }, null, 2) + "\n");
