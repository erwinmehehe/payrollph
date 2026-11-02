/**
 * Guard representative GitHub Actions path scopes.
 *
 * These lightweight assertions supplement (not replace) GitHub's actual
 * workflow-trigger semantics. If a source family gains a new dependency,
 * add a positive fixture here when expanding its PR paths.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import picomatch from "picomatch";

const workflows = Object.freeze({
  employeeBrowser: ".github/workflows/employee-import-browser-acceptance.yml",
  employeePostgres: ".github/workflows/employee-import-acceptance.yml",
  coreBrowser: ".github/workflows/core-modules-browser-acceptance.yml",
  essBrowser: ".github/workflows/ess-profile-browser-acceptance.yml",
  vaultMinio: ".github/workflows/a5-vault-minio-acceptance.yml",
  pilotPayroll: ".github/workflows/pilot-payroll-qa.yml",
  nineStage: ".github/workflows/nine-stage-connected-acceptance.yml",
});

function eventPatterns(file, event = "pull_request") {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.findIndex(line => line === "  " + event + ":");
  assert.ok(start >= 0, "Missing " + event + " trigger in " + file);
  let end = start + 1;
  while (end < lines.length &&
    !/^  [\w-]+:/.test(lines[end]) &&
    !/^[^\s#]/.test(lines[end])) end++;
  const pathLine = lines.findIndex((line, index) =>
    index > start && index < end && line === "    paths:");
  assert.ok(pathLine > start, "Missing " + event + " paths in " + file);

  const patterns = [];
  for (let i = pathLine + 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^ {6}- (["'])(.+)\1\s*$/.exec(line);
    if (!match) break;
    patterns.push(match[2]);
  }
  assert.ok(patterns.length > 0, "Missing path patterns in " + file);
  return patterns;
}

function matchesPath(patterns, filename) {
  // Apply ordered positive/negative patterns. GitHub owns final event routing.
  let selected = false;
  for (const entry of patterns) {
    const negative = entry.startsWith("!");
    const pattern = negative ? entry.slice(1) : entry;
    if (picomatch(pattern, { dot: true })(filename)) selected = !negative;
  }
  return selected;
}

function assertMatches(file, input, expected, event = "pull_request") {
  const actual = matchesPath(eventPatterns(file, event), input);
  assert.equal(actual, expected, file + " (" + event + ") on " + input);
}

test("unrelated issued-demand authorization does not launch independent costly suites", () => {
  const unrelated = [
    "src/app/api/workforce/demand-observations/issued/route.ts",
    "src/app/api/workforce/demand-observations/issued/score/route.ts",
    "src/app/api/workforce/demand-outlook/route.ts",
    "src/app/api/workforce/demand-staffing/policies/route.ts",
    "scripts/qa/tenant-isolation-coverage-manifest.json",
    "tests/tenant-isolation-coverage-inventory.test.mjs",
    "tests/tenant-issued-demand-contract.test.mjs",
  ];
  for (const file of Object.values(workflows)) {
    const patterns = eventPatterns(file);
    assert.ok(!patterns.includes("src/**") && !patterns.includes("**"),
      "Broad paths must not launch unrelated PostgreSQL/browser suites: " + file);
    for (const changed of unrelated) assertMatches(file, changed, false);
  }
  for (const changed of unrelated) {
    assertMatches(workflows.nineStage, changed, false, "push");
  }
});

test("feature code and shared authorization/schema dependencies still trigger their proofs", () => {
  const examples = [
    ["employeeBrowser", "src/app/api/employees/import/route.ts"],
    ["employeeBrowser", "scripts/employee-import-synthetic-browser.mjs"],
    ["employeePostgres", "src/lib/employee-import-preview.ts"],
    ["employeePostgres", "tests/employee-import-atomic-postgres.test.ts"],
    ["coreBrowser", "src/components/workspace/more-modules.tsx"],
    ["coreBrowser", "src/app/dashboard/page.tsx"],
    ["essBrowser", "src/app/api/self/profile/route.ts"],
    ["essBrowser", "src/lib/ess-profile-schema.ts"],
    ["vaultMinio", "src/lib/document-object-storage.ts"],
    ["vaultMinio", "src/lib/employee-document-vault.ts"],
    ["vaultMinio", "tests/fixtures/minio/Dockerfile"],
    ["pilotPayroll", "src/app/api/workforce/schedules/route.ts"],
    ["pilotPayroll", "src/app/api/workforce/timesheets/route.ts"],
    ["nineStage", "src/app/api/workforce/schedules/route.ts"],
    ["nineStage", "src/app/api/workforce/timesheets/route.ts"],
  ];
  for (const [key, file] of examples) {
    assertMatches(workflows[key], file, true);
  }
  assertMatches(workflows.nineStage,
    "src/app/api/workforce/attendance-corrections/route.ts", true, "push");

  for (const key of [
    "employeeBrowser", "employeePostgres", "coreBrowser", "essBrowser", "vaultMinio",
  ]) {
    assertMatches(workflows[key], "src/lib/access.ts", true);
    assertMatches(workflows[key], "src/db/schema.ts", true);
    assertMatches(workflows[key], "package-lock.json", true);
  }
  assertMatches(workflows.pilotPayroll, "src/lib/workforce-issued-demand-prospective.ts", true);
  assertMatches(workflows.nineStage, "src/lib/workforce-issued-demand-prospective.ts", true);
});

test("changing any optimized workflow continues to trigger its own PR acceptance", () => {
  for (const file of Object.values(workflows)) assertMatches(file, file, true);
});
