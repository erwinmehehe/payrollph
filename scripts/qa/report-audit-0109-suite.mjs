import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Reads the private, fictional CI test log and emits ONLY aggregate TAP counts.
// Never publishes the full log, fixture salaries, IDs, or a human signoff.
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
const logPath = process.env.TEST_LOG_PATH;
assert.ok(logPath && logPath.startsWith(process.env.RUNNER_TEMP + "/"));
const log = readFileSync(logPath, "utf8");
const keys = ["tests", "pass", "fail", "cancelled", "skipped", "todo"];
const summaries = Object.fromEntries(keys.map((key) => [
  key, [...log.matchAll(new RegExp("^# " + key + " +([0-9]+) *$", "gm"))].map((match) => Number(match[1])),
]));
const groupCount = summaries.tests.length;
const complete = groupCount > 0 && keys.every((key) => summaries[key].length === groupCount);
const totals = Object.fromEntries(keys.map((key) => [
  key, summaries[key].reduce((total, n) => total + n, 0),
]));
const exitCode = Number(process.env.TEST_EXIT);
const passed = complete && exitCode === 0 && totals.tests > 0 &&
  totals.pass > 0 && totals.fail === 0 && totals.cancelled === 0 &&
  totals.tests >= totals.pass;

const report = {
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runner: "isolated GitHub Actions real PostgreSQL 16 UTF8",
  migration: "drizzle/0109_tamper_evident_audit_chain.sql",
  migrationSha256: createHash("sha256").update(
    readFileSync("drizzle/0109_tamper_evident_audit_chain.sql"),
  ).digest("hex"),
  suite: "npm test",
  subprocessExitCode: exitCode,
  tapSummaryGroups: groupCount,
  ...totals,
  syntheticEngineeringStatus: passed ? "PASS" : "FAIL",
  independentHumanUat: "NOT_RUN",
  realEmployerShadowPayroll: "NOT_RUN",
  physicalDeviceCertification: "NOT_RUN",
  governmentPortalAcceptance: "NOT_RUN",
  productionAuthorization: "NOT_AUTHORIZED",
};
mkdirSync("qa-artifacts", { recursive: true });
writeFileSync("qa-artifacts/audit-0109-pg16-full-suite.json", JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
