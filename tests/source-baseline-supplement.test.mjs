import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrationCreatedObjects, objectKey } from "../scripts/lib/migration-only-objects.mjs";

const SUPPLEMENT = "docs/sql/source-baseline-supplement.sql";
const APPLIER = "scripts/qa/apply-source-baseline-supplement.mjs";
const read = (path) => readFileSync(path, "utf8");

test("the supplement is an unnumbered, clearly labelled baseline file outside drizzle/", () => {
  const sql = read(SUPPLEMENT);
  assert.match(sql, /^-- Source-first baseline supplement\. NOT a numbered migration; never run by the app\./);
  assert.match(sql, /Production remains DBA-gated/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /\b(DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|INSERT\s+INTO|UPDATE\s+\w+\s+SET)\b/i,
    "the supplement adds schema objects only; it never touches rows or drops tables");
});

test("the supplement carries the money and tenant protections a source-first baseline lacks", () => {
  const sql = read(SUPPLEMENT);
  for (const object of [
    "payroll_runs_no_overlapping_release", // 0089: one release per overlapping period
    "employee_mwe_classifications_no_approved_overlap", // 0093
    "payout_batch_tenant_guard", "payout_transfer_identity_guard", // 0116
    "wfm_punch_submission_tenant_guard", // 0120
    "payroll_entries_run_employer_fk", "payout_transfers_run_employer_fk", // 0123
  ]) assert.ok(sql.includes(object), object + " must be in the supplement");
});

test("the 0093 block is corrected from its unrunnable END $; terminator", () => {
  const source = read("drizzle/0093_mwe_classification_governance.sql");
  assert.match(source, /END \$;/, "the historical file is immutable and still contains the defect");
  const sql = read(SUPPLEMENT);
  const at = sql.indexOf("employee_mwe_classifications_no_approved_overlap\n");
  assert.ok(at > 0);
  assert.match(sql.slice(at, at + 600), /END \$\$;/);
});

test("drizzle/0133 v2 audit guards stay deferred to the role cutover, and the applier says so", () => {
  const sql = read(SUPPLEMENT);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /audit_events_insert_guard_v2|ISSUE908_FORWARD_TARGET_MISMATCH/);
  const applier = read(APPLIER);
  for (const name of ["audit_events_protect_v2", "audit_events_insert_guard_v2", "audit_events_reject_truncate_v2"]) {
    assert.ok(applier.includes(`"function:${name}"`), name);
  }
});

test("the applier only runs on the empty disposable CI database, after 0109, and proves coverage", () => {
  const applier = read(APPLIER);
  assert.match(applier, /assert\.equal\(process\.env\.GITHUB_ACTIONS, "true"/);
  assert.match(applier, /postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.match(applier, /Refusing to alter a nonempty employer database/);
  assert.match(applier, /Apply drizzle\/0109 before the supplement/);
  assert.match(applier, /missingMigrationObjects\(client\)/);
  assert.match(applier, /Excluded objects are now present; remove them from EXCLUDED/);
  const workflow = read(".github/workflows/clean-pg18-source-regression.yml");
  assert.equal((workflow.match(/node scripts\/qa\/apply-source-baseline-supplement\.mjs/g) ?? []).length, 2,
    "both the schema-export job and every regression shard build the baseline with the supplement");
  assert.match(workflow, /- "drizzle\/\*\*"/, "a new migration re-runs the coverage proof");
});

test("the clean source baseline includes the five 0134 indexes and nine tenant FKs verbatim", () => {
  const source = read("drizzle/0134_wfm_demand_missing_foundation_forward.sql");
  const indexStart = source.indexOf("-- Ensure the real worksite/job-profile parent pairs");
  const indexEnd = source.indexOf("-- Forward source section 1", indexStart);
  const tenantStart = source.indexOf("-- Additional tenant-integrity FKs");
  const tenantEnd = source.indexOf("-- No synthetic observation/forecast/policy", tenantStart);
  assert.ok(indexStart >= 0 && indexEnd > indexStart && tenantStart > indexEnd && tenantEnd > tenantStart);
  const parents = source.slice(indexStart, indexEnd).trim();
  const tenant = source.slice(tenantStart, tenantEnd).trim();
  assert.equal(((parents + tenant).match(/CREATE UNIQUE INDEX/g) ?? []).length, 5);
  assert.equal((tenant.match(/ADD CONSTRAINT /g) ?? []).length, 9);
  const baseline = read(SUPPLEMENT);
  assert.ok(baseline.includes(parents), "0134 parent unique indexes must exist in source-first baseline");
  assert.ok(baseline.includes(tenant), "0134 nine composite tenant FKs must exist in source-first baseline");
});

test("the scanner ignores objects that a later migration drops or renames", () => {
  const dir = mkdtempSync(join(tmpdir(), "migration-only-objects-"));
  try {
    writeFileSync(join(dir, "0001_a.sql"), [
      "CREATE INDEX kept_idx ON t (a);",
      "CREATE INDEX dropped_idx ON t (b);",
      "ALTER TABLE t ADD CONSTRAINT old_check CHECK (a > 0);",
      "CREATE FUNCTION guard_fn() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;",
      "CREATE TRIGGER guard_trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION guard_fn();",
      "ALTER TABLE t ADD COLUMN IF NOT EXISTS extra integer;",
    ].join("\n"));
    writeFileSync(join(dir, "0002_b.sql"), [
      "DROP INDEX IF EXISTS dropped_idx;",
      "ALTER TABLE t RENAME CONSTRAINT old_check TO new_check;",
    ].join("\n"));
    const keys = migrationCreatedObjects(dir).objects.map(objectKey).sort();
    assert.deepEqual(keys, ["column:t.extra", "function:guard_fn", "index:kept_idx", "trigger:guard_trg"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unnamed column CHECKs are detected, including ADD COLUMN, and the supplement restores them", async () => {
  const { unnamedColumnChecks } = await import("../scripts/lib/migration-only-objects.mjs");
  const dir = mkdtempSync(join(tmpdir(), "unnamed-checks-"));
  try {
    writeFileSync(join(dir, "0001_a.sql"), [
      "CREATE TABLE t (",
      "  id serial PRIMARY KEY,",
      "  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),",
      "  named integer CONSTRAINT t_named_check CHECK (named > 0),",
      "  CONSTRAINT t_table_check CHECK (id > 0)",
      ");",
      "ALTER TABLE t ADD COLUMN IF NOT EXISTS rating integer CHECK (rating BETWEEN 1 AND 5);",
    ].join("\n"));
    const found = unnamedColumnChecks(dir).map((c) => `${c.table}.${c.name}`).sort();
    assert.deepEqual(found, ["t.rating", "t.status"], "named constraints are left to the named-object scan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const sql = read(SUPPLEMENT);
  for (const name of ["leave_request_interval_sets_status_check", "hcm_employment_terms_status_check",
    "saas_billing_checkouts_amount_cents_check", "first_payroll_journey_progress_step_check"]) {
    assert.ok(sql.includes(`"${name}"`), name);
  }
});

test("the read-only schema checks accept the 0133 v2 append-only trigger", () => {
  // core-schema-readonly accepts the complete v1 or canonical v2 guard set (#1210).
  assert.match(read("src/lib/core-schema-readonly.ts"), /audit_events_protect_v2\(\)/);
  assert.match(read("scripts/check-production-schema-preflight.ts"),
    /tgfoid IN \(to_regprocedure\('public\.audit_events_protect\(\)'\), to_regprocedure\('public\.audit_events_protect_v2\(\)'\)\)/);
});
