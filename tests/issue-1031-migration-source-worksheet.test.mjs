import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseMigrationSql } from "../scripts/lib/issue-1031-sql-source-parser.mjs";
import { generateSourceWorksheet, RECEIPT_FIELDS } from "../scripts/generate-issue-1031-source-worksheet.mjs";

const root = resolve(import.meta.dirname, "..");
const read = file => readFileSync(resolve(root, file), "utf8");

test("source-only worksheet covers every drizzle file with current byte SHA and no populated receipts", () => {
  const result = generateSourceWorksheet();
  assert.equal(result.summary.totalDrizzleFiles, 152);
  assert.equal(result.summary.numberedSqlFiles, 150);
  assert.equal(result.summary.sqlFiles, 151);
  assert.equal(result.summary.sourceSchemaTables, 273);
  assert.equal(result.summary.duplicatePrefixGroups, 13);
  // P0-4 step 3: no request-time schema creator remains in the source inventory.
  assert.deepEqual(result.ambiguities.runtimeOnlyTables, []);
  assert.deepEqual(result.ambiguities.runtimeOnlyFiles, []);
  assert.ok(result.migrationRows.every(row => row.runtime_only_ddl_candidates === ""),
    "migration worksheet must not invent retired runtime-compatibility DDL");
  assert.ok(result.tableRows.every(row =>
    row.runtime_compatibility_create_sources === "" &&
    row.runtime_only_without_numbered_migration === ""),
    "table crosswalk must not claim a retired request-time creator");
  assert.ok(result.migrationRows.some(row => row.file_path === "drizzle/0127_year_end_prior_evidence.sql" && row.creates_objects.includes("year_end_prior_evidence")));
  assert.ok(result.tableRows.some(row => row.schema_table === "year_end_prior_evidence"));
  // A new numbered source must be included without assigning an apply receipt.
  const rename = result.migrationRows.find(row =>
    row.file_path === "drizzle/0128_recovery_foreign_key_names_forward.sql");
  assert.ok(rename, "0128 must be recorded in the source inventory");
  assert.equal(rename.statement_count, 50, "one preflight DO and 49 FK renames");
  assert.ok(rename.requires_tables.includes("employee_availability_rules"));
  assert.equal(rename.receipt_found, "");
  assert.equal(rename.disposition, "");
  // Both proposed 0128 and 0129 are source paths only. Their checksums
  // exist for comparison, not as invented live migration journal entries.
  for (const path of [
    "drizzle/0128_recovery_foreign_key_names_forward.sql",
    "drizzle/0129_non_recovery_fk_names_forward.sql",
  ]) {
    const matches=result.migrationRows.filter(row=>row.file_path===path);
    assert.equal(matches.length,1,path);
    assert.match(matches[0].sha256_exact_committed_bytes,/^[a-f0-9]{64}$/);
    assert.ok(matches[0].statement_count !== "");
    if (path === "drizzle/0129_non_recovery_fk_names_forward.sql") {
      assert.equal(matches[0].manual_review_flags,
        "DOLLAR_BODY_MANUAL_REVIEW | DYNAMIC_SQL_REVIEW | PROCEDURAL_SQL_REVIEW",
        "review-only table-lock EXECUTE must remain flagged as dynamic SQL");
    }
    for (const field of RECEIPT_FIELDS) assert.equal(matches[0][field],"",path+" "+field);
  }
  // The new 0133 foundation/guard source is not proof of a live apply.
  // Keep its exact-byte checksum and its hazardous procedural/DML source flags.
  const auditFoundation = result.migrationRows.find(row =>
    row.file_path === "drizzle/0133_audit_missing_foundation_forward.sql");
  assert.ok(auditFoundation, "0133 must be inventoried as a source-only migration");
  assert.match(auditFoundation.sha256_exact_committed_bytes, /^[a-f0-9]{64}$/);
  assert.equal(auditFoundation.statement_count, 19);
  assert.equal(auditFoundation.creates_objects, "audit_chain_heads");
  assert.equal(auditFoundation.source_schema_objects, "audit_events");
  assert.equal(auditFoundation.objects_not_in_source_schema, "audit_chain_heads");
  assert.match(auditFoundation.manual_review_flags, /DOLLAR_BODY_MANUAL_REVIEW/);
  assert.match(auditFoundation.hazards, /BACKFILL/);
  for (const field of RECEIPT_FIELDS) assert.equal(auditFoundation[field], "");

  const recoveredCandidate = result.migrationRows.find(row =>
    row.file_path === "drizzle/0134_wfm_demand_missing_foundation_forward.sql");
  assert.ok(recoveredCandidate, "0134 must be inventoried as source, never as live proof");
  assert.match(recoveredCandidate.sha256_exact_committed_bytes, /^[a-f0-9]{64}$/);
  for (const name of [
    "workforce_demand_import_batches", "workforce_demand_observation_revisions",
    "workforce_demand_forecast_issues", "workforce_demand_forecast_scores",
    "workforce_demand_staffing_policies", "workforce_demand_staffing_policy_events",
  ]) assert.ok(recoveredCandidate.creates_objects.includes(name), name);
  for (const field of RECEIPT_FIELDS) assert.equal(recoveredCandidate[field], "");
  assert.equal(recoveredCandidate.numeric_prefix, "0134");

  // First forward migration after the cutover: source inventory only, no receipt.
  const correctionCases = result.migrationRows.find(row =>
    row.file_path === "drizzle/0135_salary_correction_cases.sql");
  assert.ok(correctionCases, "0135 must be inventoried as source, never as live proof");
  assert.equal(correctionCases.numeric_prefix, "0135");
  for (const name of ["salary_correction_cases", "salary_correction_case_runs"]) {
    assert.ok(correctionCases.creates_objects.includes(name), name);
    assert.ok(result.tableRows.some(row => row.schema_table === name), name + " in source crosswalk");
  }
  for (const field of RECEIPT_FIELDS) assert.equal(correctionCases[field], "");

  // A new additive security index is SOURCE, not a live application receipt.
  const activeReceiptIndex = result.migrationRows.find(row =>
    row.file_path === "drizzle/0136_statutory_payment_evidence_one_active.sql");
  assert.ok(activeReceiptIndex, "0136 must be counted in source inventory");
  assert.equal(activeReceiptIndex.numeric_prefix, "0136");
  assert.equal(activeReceiptIndex.statement_types, "CREATE INDEX | PROCEDURAL");
  assert.equal(activeReceiptIndex.statement_count, 2);
  assert.equal(activeReceiptIndex.source_schema_objects, "statutory_remittance_payment_evidence");
  assert.ok(activeReceiptIndex.candidate_prior_source_files_not_receipts.includes(
    "drizzle/0031_statutory_remittance_payment_evidence.sql"));
  assert.match(activeReceiptIndex.manual_review_flags, /DOLLAR_BODY_MANUAL_REVIEW/);
  for (const field of RECEIPT_FIELDS) assert.equal(activeReceiptIndex[field], "",
    "0136 is never treated as a production apply");

  const paths = readdirSync(resolve(root, "drizzle")).map(name => "drizzle/" + name).sort();
  assert.deepEqual(result.migrationRows.map(row => row.file_path).sort(), paths);
  assert.equal(new Set(result.migrationRows.map(row => row.file_path)).size, paths.length);
  assert.ok(result.migrationRows.every(row => /^[0-9a-f]{64}$/.test(row.sha256_exact_committed_bytes)));
  for (const row of result.migrationRows) {
    for (const field of RECEIPT_FIELDS) assert.equal(row[field], "", row.file_path + ": " + field);
    assert.ok(!/(^|[;,])\s*(applied|baseline-included|skipped)\s*($|[;,])/i.test(row.canonical_per_history_guard));
  }
  for (const row of result.tableRows) {
    assert.equal(row.production_absent_name_independently_attested, "");
  }
  assert.equal(read("docs/engineering/issue-1031-migration-source-worksheet.csv"), result.migrationCsv);
  assert.equal(read("docs/engineering/issue-1031-source-table-crosswalk.csv"), result.tableCsv);
  execFileSync(process.execPath, ["scripts/generate-issue-1031-source-worksheet.mjs", "--check"], {
    cwd: root, env: { PATH: process.env.PATH }, stdio: "pipe",
  });
});

test("all legacy duplicate prefixes preserve each full path without a fake canonical", () => {
  const result = generateSourceWorksheet();
  const expected = ["0021","0024","0026","0027","0030","0031","0039","0049","0065","0082","0086","0092","0093"];
  assert.deepEqual(result.ambiguities.duplicatePrefixes.map(x => x.prefix), expected);
  for (const group of result.ambiguities.duplicatePrefixes) {
    const rows = result.migrationRows.filter(r => r.numeric_prefix === group.prefix);
    assert.equal(rows.length, group.files.length);
    for (const row of rows) {
      assert.equal(row.duplicate_prefix, "yes");
      assert.match(row.canonical_per_history_guard, /^NONE/);
      assert.match(row.history_guard_reference, /check-sql-migration-history/);
      for (const file of group.files) assert.ok(row.all_colliding_files.includes(file));
    }
  }
});

test("SQL parser honors quoted content, nested comments and dollar bodies while flagging mutations", () => {
  const sample = [
    "-- DROP TABLE imaginary;\n/* UPDATE imaginary SET x=1; /* nested */ */",
    "CREATE TABLE IF NOT EXISTS \"RealTable\" (id integer REFERENCES public.parent_table(id), note text DEFAULT 'DELETE FROM z;');",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_real ON \"RealTable\" (id);",
    "ALTER TABLE \"RealTable\" DROP CONSTRAINT IF EXISTS old_ck;",
    "UPDATE \"RealTable\" SET note='semi;colon';",
    "DELETE FROM \"RealTable\" WHERE id = 0;",
    "DO $block$ BEGIN EXECUTE 'DROP TABLE hidden'; END $block$;",
  ].join("\n");
  const parsed = parseMigrationSql(sample);
  assert.ok(parsed.creates.includes("RealTable"));
  assert.ok(parsed.objects.includes("RealTable"));
  assert.ok(parsed.requires.includes("parent_table"));
  for (const flag of ["DROP","UPDATE","DELETE","BACKFILL"]) assert.ok(parsed.hazards.includes(flag), flag);
  assert.ok(parsed.review.includes("DYNAMIC_SQL_REVIEW"));
  assert.ok(parsed.review.includes("DOLLAR_BODY_MANUAL_REVIEW"));
  assert.ok(!parsed.objects.includes("imaginary"));
});

test("malformed historical DO dollar block is explicitly flagged, not guessed or executed", () => {
  const row = generateSourceWorksheet().migrationRows.find(r => r.file_path ===
    "drizzle/0093_mwe_classification_governance.sql");
  assert.ok(row);
  assert.match(row.statement_types, /CREATE TABLE/);
  assert.match(row.hazards, /PARSER_UNCERTAINTY/);
  assert.match(row.manual_review_flags, /UNTERMINATED_DOLLAR_BODY/);
});

test("no SQL execution or production-verification transport is referenced by generator", () => {
  const content = read("scripts/generate-issue-1031-source-worksheet.mjs");
  assert.doesNotMatch(content, /PRODUCTION_DATABASE_URL|DATABASE_URL|PRODUCTION_MIGRATION_AUDIT_DATABASE_URL/);
  assert.doesNotMatch(content, /\b(?:new Client|pool\.query|db\.execute|fetch\()\b/);
});
