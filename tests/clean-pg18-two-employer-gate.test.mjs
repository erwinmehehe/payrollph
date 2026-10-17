import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// No run can label the original two-employer suite accepted from the separate
// schema or regression jobs alone. This guards the wiring; actual behavior is
// exercised by fresh-PG18 workflow jobs against disposable PostgreSQL.
const pg18 = readFileSync(".github/workflows/clean-pg18-source-regression.yml", "utf8");
const journey = readFileSync(".github/workflows/nine-stage-connected-acceptance.yml", "utf8");

test("clean PG18 gate is selected by both PR and main schema/journey changes", () => {
  const pull = pg18.split("  pull_request:\n")[1]?.split("  push:\n")[0];
  const push = pg18.split("  push:\n")[1]?.split("  workflow_dispatch:\n")[0];
  for (const section of [pull, push]) {
    assert.ok(section, "Missing PR or main workflow trigger");
    for (const name of [
      "src/db/schema.ts", "drizzle.config.ts",
      ".github/workflows/nine-stage-connected-acceptance.yml",
      "scripts/qa/nine-stage-connected-acceptance.ts",
      "scripts/qa/issue-853-synthetic-coverage.mjs",
      "tests/clean-pg18-two-employer-gate.test.mjs",
    ]) {
      assert.ok(section.includes(JSON.stringify(name)), "A source dependency no longer triggers the gate: " + name);
    }
  }
});

test("same-sha, full-regression and authenticated PG18 source journey gate one another", () => {
  assert.match(pg18, /connected-journey:\n\s+name:[^\n]+\n\s+needs: \[source-ddl, regression\]/);
  assert.match(pg18, /uses: \.\/\.github\/workflows\/nine-stage-connected-acceptance\.yml\n\s+with:\n\s+pg18_only: true/);
  assert.match(pg18, /complete-gate:\n\s+name:[^\n]+\n\s+needs: \[source-ddl, regression, connected-journey\]\n\s+if: always\(\)/);
  assert.match(pg18, /for key in SCHEMA_RESULT REGRESSION_RESULT JOURNEY_RESULT/);
  assert.match(pg18, /if \[\[ "\$\{!key\}" != "success" \]\]; then/);
  assert.match(pg18, /SOURCE_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(pg18, /NINE_STAGE_PG_MAJOR: "18"/);
  assert.match(pg18, /FRESH_PG18_DEV_REHEARSAL: disposable-ci-only/);
  assert.match(pg18, /DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.doesNotMatch(pg18, /secrets:\s+inherit/);
});

test("reused nine-stage workflow preserves 4 standalone cases and only 1 PG18 case when called", () => {
  assert.match(journey, /workflow_call:\n\s+inputs:\n\s+pg18_only:/);
  const line = journey.split("\n").find(s => s.trim().startsWith("include: ${{ fromJSON(inputs.pg18_only"));
  assert.ok(line, "Missing boolean-isolated job matrix");
  const parts = /include: \$\{\{ fromJSON\(inputs\.pg18_only && '([^']+)' \|\| '([^']+)'\) \}\}/.exec(line);
  assert.ok(parts, "Matrix must safely select from explicit JSON configurations");
  const selected = JSON.parse(parts[1]), defaultMatrix = JSON.parse(parts[2]);
  assert.deepEqual(selected, [{ "hire-mode": "governed", postgres: "18" }]);
  assert.equal(defaultMatrix.length, 4);
  assert.ok(defaultMatrix.some(x => x["hire-mode"] === "direct" && x.postgres === "16"));
  assert.ok(defaultMatrix.some(x => x["hire-mode"] === "governed" && x.postgres === "16" && x.cutoff === "year-end"));
  assert.ok(defaultMatrix.some(x => x["hire-mode"] === "governed" && x.postgres === "18"));
  // Called workflows get the caller's github.workflow. They must never share
  // the caller's concurrency group or cancel the parent gate before it completes.
  assert.match(journey, /group: nine-stage-source-\$\{\{ github\.workflow \}\}/);
  assert.match(journey, /NINE_STAGE_EVIDENCE_REQUIRED: "true"/);
  assert.match(journey, /NINE_STAGE_GOVERNED_HIRE_REQUIRED: "true"/);
  assert.match(journey, /node scripts\/qa\/issue-853-synthetic-coverage\.mjs/);
  assert.match(journey, /node scripts\/qa\/fresh-pg18-development-schema\.mjs preflight/);
  assert.match(journey, /node scripts\/qa\/verified-pg18-bootstrap\.mjs/);
  assert.match(journey, /node scripts\/qa\/fresh-pg18-development-schema\.mjs capture/);
});

test("PG18 end-to-end has no production DB, money or filing-submission path", () => {
  for (const source of [pg18, journey]) {
    for (const flag of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
      "FINAL_PAY_MANUAL_RELEASE_ENABLED"]) {
      assert.ok(source.includes(flag + ': "false"'), flag + " not pinned off");
    }
    assert.ok(source.includes('OPENAI_API_KEY: ""'));
    assert.ok(source.includes('PAYMONGO_SECRET_KEY: ""'));
    assert.ok(source.includes('XENDIT_SECRET_KEY: ""'));
    assert.doesNotMatch(source, /secrets:\s+inherit/);
  }
});
