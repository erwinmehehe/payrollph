import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Scope only uncredited, non-source-pinned workflows. Accepted or pending
// byte-pinned PG16 workflows MUST retain their manifest triggers and exact
// executed blobs. The required security and source-only checks are unchanged.
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const SHARED_INVENTORY_PATHS = [
  MANIFEST,
  "tests/tenant-isolation-coverage-inventory.test.mjs",
  "docs/engineering/tenant-isolation-closure-plan.md",
];
const FEATURE_WORKFLOWS = [
  "remittance-action-tenant-isolation.yml",
  "tenant-discipline-case-boundary.yml"
];
// Fail closed on every real feature trigger. Checking only that one route or
// QA path remains would let a future edit silently skip tenant acceptance
// when another source, runner, or fixture changes.
const FEATURE_REQUIRED_PATHS = {
  "remittance-action-tenant-isolation.yml": [
    "src/app/api/compliance/remittance-actions/route.ts",
    "src/lib/statutory-remittance-task-scope.ts",
    "src/lib/statutory-remittance-actions.ts",
    "src/lib/statutory-remittance-escalations.ts",
    "scripts/qa/remittance-action-entity-http.mjs",
    "tests/statutory-remittance-task-scope.test.ts",
    ".github/workflows/remittance-action-tenant-isolation.yml",
  ],
  "tenant-discipline-case-boundary.yml": [
    ".github/workflows/tenant-discipline-case-boundary.yml",
    "src/app/api/discipline/route.ts",
    "tests/tenant-discipline-case-boundary.test.mjs",
    "scripts/qa/tenant-table-rows/read/people.mjs",
    "scripts/qa/tenant-table-rows/write/people.mjs",
  ],
};
const SOURCE_PINNED_WORKFLOWS = [
  "salary-correction-cases-qa.yml",
  "tenant-benefit-catalog-put.yml",
  "tenant-clock-lifecycle.yml",
  "tenant-dl01-closure.yml",
  "tenant-dl02-closure.yml",
  "tenant-dl02-qa.yml",
  "tenant-hcm-manager-attestation-recovery.yml",
  "tenant-hcm-salary-correction-preview.yml",
  "tenant-hcm-sla-escalate-http.yml",
  "tenant-onboarding-http.yml",
  "tenant-table-proof.yml",
  "tenant-v1-journal-http.yml"
];

function workflow(filename) {
  return readFileSync(
    new URL("../.github/workflows/" + filename, import.meta.url), "utf8",
  );
}

function pullRequestPaths(filename) {
  const source = workflow(filename);
  const begin = source.indexOf("\n  pull_request:\n");
  assert.ok(begin !== -1, filename + ": missing PR event");
  const after = source.slice(begin + "\n  pull_request:\n".length);
  const match = after.match(/^    paths:\n((?:      - [^\n]+\n)+)/m);
  assert.ok(match, filename + ": missing PR path filters");
  const lines = match[1].trimEnd().split("\n");
  return lines.map((line) => {
    const item = line.match(/^      - (?:'([^']+)'|"([^"]+)"|(\S+))$/);
    assert.ok(item, filename + ": unparseable path " + line);
    return item[1] ?? item[2] ?? item[3];
  });
}

function matches(pattern, file) {
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

test("only non-source-pinned scopes skip manifest-only changes", () => {
  for (const filename of FEATURE_WORKFLOWS) {
    const paths = pullRequestPaths(filename);
    assert.ok(paths.includes(".github/workflows/" + filename),
      filename + ": own workflow changes must still trigger acceptance");
    assert.deepEqual([...paths].sort(), [...FEATURE_REQUIRED_PATHS[filename]].sort(),
      filename + ": all route, helper, proof runner, fixture, test and workflow triggers must stay intact");
    for (const sharedFile of SHARED_INVENTORY_PATHS) {
      assert.equal(paths.some((path) => matches(path, sharedFile)), false,
        filename + ": broad shared-inventory trigger starts an unrelated expensive suite: " + sharedFile);
    }
  }
});

test("source-pinned tenant proof workflows retain all shared manifest triggers", () => {
  for (const filename of SOURCE_PINNED_WORKFLOWS) {
    const paths = pullRequestPaths(filename);
    assert.ok(paths.some(pattern => matches(pattern, MANIFEST)),
      filename + ": exact-source PG16 proof cannot silently lose its ledger trigger");
    assert.ok(paths.includes(".github/workflows/" + filename),
      filename + ": changing an executed proof workflow must trigger renewed evidence");
  }
});

test("shared ledger changes retain mandatory security and targeted source review", () => {
  for (const filename of [
    "tenant-six-method-proof-review.yml",
    "tenant-payout-profiles-patch-http.yml",
    "tenant-gap-batch-factory.yml",
  ]) {
    const paths = pullRequestPaths(filename);
    assert.ok(paths.some((pattern) => matches(pattern, MANIFEST)),
      filename + ": must still watch ledger changes");
  }
  const security = workflow("security-http-smoke.yml");
  assert.match(security, /^  pull_request:$/m, "required security workflow must run on every PR");
  assert.match(security, /tests\/tenant-isolation-coverage-inventory\.test\.mjs/,
    "manifest source and credit checks must remain in the required security job");
  assert.match(security, /^  security-http-smoke:$/m, "preserve required security status");
  assert.match(workflow("ci.yml"), /^  check:$/m, "preserve required core CI status");
  assert.match(workflow("payout-payroll-isolation.yml"), /^  payout-payroll-isolation:$/m);
  assert.match(workflow("codeql.yml"), /name: Analyze JavaScript and TypeScript/);
});

test("historical PR 1302 source guard keeps its PR trigger", () => {
  const historical = workflow("draft-1302-tenant-read-proof.yml");
  assert.match(historical, /^  pull_request:$/m,
    "the source-pinned #1302 contract requires the PR event");
  assert.match(historical, /github\.event\.pull_request\.number == 1302/,
    "historical source proof must only run for its original PR");
});
