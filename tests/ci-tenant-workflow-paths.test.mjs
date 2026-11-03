import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Changing the shared ledger must not launch every independent PG16 HTTP suite.
// Manifest integrity and source-pinning are enforced by the required Security
// HTTP Smoke check and the dedicated source-only six-method review.
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const FEATURE_WORKFLOWS = [
  "remittance-action-tenant-isolation.yml",
  "salary-correction-cases-qa.yml",
  "tenant-benefit-catalog-put.yml",
  "tenant-clock-lifecycle.yml",
  "tenant-discipline-case-boundary.yml",
  "tenant-dl01-closure.yml",
  "tenant-dl02-closure.yml",
  "tenant-dl02-qa.yml",
  "tenant-hcm-manager-attestation-recovery.yml",
  "tenant-hcm-salary-correction-preview.yml",
  "tenant-hcm-sla-escalate-http.yml",
  "tenant-onboarding-http.yml",
  "tenant-table-proof.yml",
  "tenant-v1-journal-http.yml",
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

test("unrelated tenant real-HTTP suites do not run for a shared manifest-only change", () => {
  for (const filename of FEATURE_WORKFLOWS) {
    const paths = pullRequestPaths(filename);
    assert.ok(paths.includes(".github/workflows/" + filename),
      filename + ": own workflow changes must still trigger acceptance");
    assert.ok(paths.some((path) => path.startsWith("src/app/api/") || path.startsWith("scripts/qa/")),
      filename + ": must retain its executable route or proof runner trigger");
    assert.equal(paths.some((path) => matches(path, MANIFEST)), false,
      filename + ": broad manifest-only trigger starts unrelated expensive suite");
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

test("merged historical PR 1302 proof is manual-only", () => {
  const historical = workflow("draft-1302-tenant-read-proof.yml");
  assert.doesNotMatch(historical, /^  pull_request:$/m,
    "merged PR 1302 cannot launch a skipped job on current PRs");
  assert.match(historical, /^  workflow_dispatch:$/m);
  assert.match(historical, /if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/);
});
