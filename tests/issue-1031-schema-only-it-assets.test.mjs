import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseMigrationSql } from "../scripts/lib/issue-1031-sql-source-parser.mjs";

const path = "docs/sql/issue-1031-schema-only-it-assets-review.sql";
const sql = readFileSync(path, "utf8");
const executable = sql.replace(/--[^\n]*/g, "");
const target = [
  "it_applications", "it_managed_devices", "it_access_grants", "it_device_events",
];
const base = ["organizations", "users", "employees", "assets"];

test("#1031 IT-only proposal cannot be mistaken for a receipt, deployment or numbered migration", () => {
  assert.match(sql, /REVIEW-ONLY CANDIDATE/);
  assert.match(sql, /NO-GO/);
  assert.match(executable, /^\s*BEGIN\s*;/);
  assert.match(executable, /COMMIT\s*;\s*$/);
  assert.equal((executable.match(/\bBEGIN\s*;/g) ?? []).length, 1);
  assert.equal((executable.match(/\bCOMMIT\s*;/g) ?? []).length, 1);
  assert.doesNotMatch(executable,
    /\b(?:ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|CONSTRAINT)|TRUNCATE|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|MERGE\s+INTO|GRANT|REVOKE|COPY|EXECUTE)\b/i);
  assert.doesNotMatch(executable, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i);
  const parsed = parseMigrationSql(executable);
  assert.deepEqual(parsed.creates, [...target].sort());
  assert.deepEqual(parsed.hazards, []);
});

test("#1031 IT-only preflight checks every exact prerequisite and refuses any preexisting target", () => {
  assert.match(executable, /DO \$issue1031_it_guard\$/);
  assert.match(executable, /ISSUE1031_IT_BASE_DEPENDENCY_MISSING/);
  assert.match(executable, /ISSUE1031_IT_TARGET_ALREADY_PRESENT/);
  const guard = executable.split("END $issue1031_it_guard$;")[0];
  for (const name of base) assert.ok(guard.includes("to_regclass('public." + name + "') IS NULL"), name);
  for (const name of target) assert.ok(guard.includes("to_regclass('public." + name + "') IS NOT NULL"), name);
  for (const name of target) assert.equal(
    (executable.match(new RegExp('CREATE TABLE "' + name + '"', "g")) ?? []).length, 1, name);
});

test("#1019 stable composite-unique drift is outside this SQL candidate", () => {
  const parsed = parseMigrationSql(executable);
  assert.deepEqual(parsed.objects, [...target].sort());
  for (const unrelated of ["documents", "employee_hr_cases"]) {
    assert.ok(!parsed.objects.includes(unrelated), "unrelated HR FK not in this proposal");
    assert.ok(!executable.includes('"' + unrelated + '"'), "must not repair upstream Drizzle bug via IT SQL");
  }
});

test("#1031 IT-only source groups contain no historical migration or application edits", () => {
  const crosswalk = readFileSync("docs/engineering/issue-1031-source-table-crosswalk.csv", "utf8");
  for (const name of target) {
    assert.ok(crosswalk.includes('"' + name + '","","'), "table must be schema-only: " + name);
  }
  assert.match(executable, /CHECK \("state" in \('available','assigned','return_requested','returned','lost','retired'\)\)/);
  assert.match(executable, /CHECK \("state" in \('grant_requested','active','revoke_requested','revoked'\)\)/);
});

test("#1031 owner-approved catalog-first acceptance does not require a second push", () => {
  const wf = readFileSync(".github/workflows/issue-1031-schema-only-it-assets-rehearsal.yml", "utf8");
  const policy = readFileSync("docs/engineering/issue-1019-schema-repair-acceptance-policy.md", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.devDependencies["drizzle-kit"], "0.31.11");
  assert.equal(pkg.dependencies["drizzle-orm"], "0.45.4");
  assert.match(wf, /postgres: \["16", "18"\]/);
  assert.match(wf, /npm run db:push/);
  assert.match(wf, /schema-only-it-assets-postgres\\.test\\.ts/);
  assert.match(wf, /npm test/);
  assert.doesNotMatch(wf, /isolated-rc-repeat-proof:|drizzle-kit@1\\.0\\.0-rc\\.4|SEPARATE_RC_TRUE_NO_OP=PASS/);
  assert.match(policy, /Second drizzle-kit push: not used as a gate, see #1019/);
  assert.match(policy, /Deliberately change one candidate column type/);
  assert.match(policy, /Reject full repeat application and partial-target application/);
  assert.match(policy, /23503/);
});
