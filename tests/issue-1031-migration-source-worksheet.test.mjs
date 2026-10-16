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
  assert.equal(result.summary.totalDrizzleFiles, 142);
  assert.equal(result.summary.numberedSqlFiles, 140);
  assert.equal(result.summary.sqlFiles, 141);
  assert.equal(result.summary.sourceSchemaTables, 270);
  assert.equal(result.summary.duplicatePrefixGroups, 13);
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
