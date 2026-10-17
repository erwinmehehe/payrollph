import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const candidate = readFileSync("docs/sql/issue-1113-worksite-decision-forward-candidate.sql", "utf8");
const appSchema = readFileSync("src/db/schema.ts", "utf8");
const historical = readFileSync("drizzle/0023_workforce_worksites.sql", "utf8");
const hcmDecision = readFileSync("drizzle/0058_hcm_worksite_authorization_decisions.sql", "utf8");

test("#1113 observed historical omission is a separate worksite assignment table", () => {
  assert.match(appSchema, /employeeWorksiteAssignments = pgTable\(\s*"employee_worksite_assignments"/);
  assert.match(appSchema, /decision: varchar\("decision", \{ length: 8 \}\)\.notNull\(\)\.default\("allow"\)/);
  assert.match(historical, /CREATE TABLE IF NOT EXISTS "employee_worksite_assignments"/);
  assert.doesNotMatch(historical, /"decision"/);
  assert.match(hcmDecision, /ALTER TABLE "hcm_worksite_authorizations"/);
  assert.doesNotMatch(hcmDecision, /ALTER TABLE "employee_worksite_assignments"/);
});

test("#1113 candidate is intentionally unnumbered, atomic, narrow and fail-closed", () => {
  assert.match(candidate, /REVIEW-ONLY, UNNUMBERED FORWARD CANDIDATE/);
  assert.match(candidate, /DO \$issue1113_worksite_decision\$/);
  assert.match(candidate, /LOCK TABLE public\.employee_worksite_assignments IN ACCESS EXCLUSIVE MODE NOWAIT/);
  for (const marker of [
    "ISSUE1113_WORKSITE_ASSIGNMENTS_TABLE_MISSING",
    "ISSUE1113_UNEXPECTED_WORKSITE_RELATION",
    "ISSUE1113_DECISION_ALREADY_PRESENT_REQUIRES_REVIEW",
    "ISSUE1113_PREEXISTING_COLUMNS_DRIFTED",
    "ISSUE1113_PREEXISTING_PRIMARY_KEY_DRIFTED",
    "ISSUE1113_PREEXISTING_TENANT_FOREIGN_KEYS_DRIFTED",
    "ISSUE1113_POSTFLIGHT_DECISION_SCHEMA_MISMATCH",
  ]) assert.ok(candidate.includes(marker), marker);
  assert.match(candidate, /ADD COLUMN decision varchar\(8\) NOT NULL DEFAULT ''allow''/);
  const executable = candidate.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(executable, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|CREATE\s+TABLE|GRANT|COMMIT)\b/i);
  assert.doesNotMatch(executable, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
  assert.doesNotMatch(executable, /\b(?:separation_records|payroll_entries|payroll_runs)\b/i);
});

test("#1113 PostgreSQL rehearsal is guarded to isolated CI, records rollback and leaves flags off", () => {
  const workflow = readFileSync(".github/workflows/issue-1113-worksite-forward-qa.yml", "utf8");
  const pgTest = readFileSync("tests/issue-1113-worksite-decision-postgres.test.mjs", "utf8");
  const doc = readFileSync("docs/engineering/issue-1113-worksite-decision-plan.md", "utf8");
  assert.match(workflow, /postgres: \$\{\{ matrix\.postgres \}\}/);
  assert.match(workflow, /postgres: \["16", "18"\]/);
  assert.match(workflow, /MIGRATION_REHEARSAL_MODE: isolated-ci-only/);
  assert.match(workflow, /ISSUE_1113_REHEARSAL: isolated-ci-only/);
  assert.match(workflow, /postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.match(workflow, /node --test tests\/issue-1113-worksite-decision-postgres\.test\.mjs/);
  assert.match(workflow, /node --test tests\/isolated-migration-target\.test\.mjs/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /environment:\s*production|secrets\.|PRODUCTION_DATABASE_URL|ORDERED_RELEASE_MIGRATIONS_ENABLED/);
  assert.match(pgTest, /assertIsolatedMigrationTarget\(process\.env\)/);
  assert.match(pgTest, /"ROLLBACK"/);
  assert.doesNotMatch(pgTest, /db\.query\("COMMIT"\)/);
  assert.match(doc, /#1136/);
  assert.match(doc, /#907/);
  assert.match(doc, /#899/);
  assert.match(doc, /#1113/);
});
