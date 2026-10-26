import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MONEY = [
  "treasury-isolation.yml",
  "paymongo-export-isolation.yml",
  "underpayment-posting.yml",
  "tenant-money-lifecycle.yml",
];
const ALL = [...MONEY, "public-intake-db-acceptance.yml"];

function readWorkflow(filename) {
  return readFileSync(
    new URL("../.github/workflows/" + filename, import.meta.url), "utf8",
  );
}

function pullRequestPaths(filename) {
  const workflow = readWorkflow(filename);
  const begin = workflow.indexOf("\n  pull_request:\n");
  assert.ok(begin >= 0, filename + ": missing pull_request");
  const remaining = workflow.slice(begin + "\n  pull_request:\n".length);
  const boundaries = [
    remaining.indexOf("\n  push:\n"),
    remaining.indexOf("\n  workflow_dispatch:\n"),
    remaining.indexOf("\n  schedule:\n"),
  ].filter((index) => index >= 0);
  assert.ok(boundaries.length > 0, filename + ": missing next event boundary");
  const block = remaining.slice(0, Math.min(...boundaries));
  assert.match(block, /^    branches: \[main\]$/m, filename);
  assert.match(block, /^    paths:$/m, filename);
  const paths = [...block.matchAll(/^      - '([^']+)'$/gm)].map((match) => match[1]);
  assert.ok(paths.length > 0, filename + ": missing path filters");
  return paths;
}

// All workflow globs are intentionally limited to literal paths, * and **.
// This matcher tests those supported forms without adding a new dependency.
function matchGlob(pattern, file) {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i++;
      } else {
        regex += "[^/]*";
      }
    } else if (ch === "?") {
      regex += "[^/]";
    } else {
      regex += ".+^$()[]{}|\\".includes(ch) ? "\\" + ch : ch;
    }
  }
  return new RegExp(regex + "$").test(file);
}

function workflowsForFile(path) {
  return ALL.filter((filename) =>
    pullRequestPaths(filename).some((pattern) => matchGlob(pattern, path)));
}

test("optional heavy workflows retain main/manual coverage and self-triggers", () => {
  const disallowed = new Set(["**", "src/**", "scripts/**", "tests/**", "public/**", ".github/**"]);
  for (const filename of ALL) {
    const source = readWorkflow(filename);
    const paths = pullRequestPaths(filename);
    assert.ok(paths.includes(".github/workflows/" + filename), filename);
    assert.ok(paths.every((p) => !p.startsWith("!")), filename + ": unexpected negative pattern");
    assert.ok(paths.every((p) => !disallowed.has(p)), filename + ": broad path filter");
    assert.match(source, /\n  workflow_dispatch:\n/, filename);
    if (MONEY.includes(filename)) {
      assert.match(source, /\n  push:\n    branches: \[main\]/, filename);
    } else {
      assert.doesNotMatch(source, /\n  push:\n/, filename);
    }
  }
});

test("unrelated edits do not launch expensive module-specific workflows", () => {
  for (const path of [
    "README.md",
    ".github/workflows/ci.yml",
    "tests/unrelated.test.ts",
    "src/components/marketing/site-chrome.tsx",
    "src/app/api/health/route.ts",
  ]) assert.deepEqual(workflowsForFile(path), [], path);
});

test("shared auth, schema, and dependency changes keep complete coverage", () => {
  for (const path of [
    "src/lib/auth.ts",
    "src/lib/access.ts",
    "src/db/schema.ts",
    "drizzle/0200_finance.sql",
    "package-lock.json",
    "src/app/api/organizations/route.ts",
  ]) assert.deepEqual(workflowsForFile(path), ALL, path);
});

test("money-sensitive code runs relevant suites without launching public intake", () => {
  for (const path of [
    "src/app/api/payroll-runs/route.ts",
    "src/lib/payroll-engine.ts",
    "src/app/api/approvals/123/route.ts",
  ]) assert.deepEqual(workflowsForFile(path), MONEY, path);
  assert.deepEqual(workflowsForFile("src/lib/paymongo-disbursements.ts"), MONEY.slice(0, 2));
  assert.deepEqual(workflowsForFile("src/lib/underpayment-duplicate.ts"), MONEY.slice(2, 4));
  assert.deepEqual(workflowsForFile("src/app/api/treasury-controls/route.ts"), MONEY.slice(0, 3));
  assert.deepEqual(workflowsForFile(".github/workflows/underpayment-posting.yml"), [MONEY[2]]);
});

test("public intake routes and the proposal SQL only run the intake suite", () => {
  const intake = [ALL[4]];
  for (const path of [
    "src/app/api/demo-requests/route.ts",
    "src/app/api/intake-challenge/route.ts",
    "src/app/api/payroll-outsourcing/quote/route.ts",
    "src/app/api/careers/admin/route.ts",
    "src/lib/marketing-consent.ts",
    "scripts/public-intake-db-acceptance.ts",
    "tests/careers-http-postgres.test.ts",
    "docs/engineering/migration-proposals/careers-published.sql",
  ]) assert.deepEqual(workflowsForFile(path), intake, path);
});
