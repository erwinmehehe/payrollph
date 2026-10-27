#!/usr/bin/env node
/**
 * #1031/P0-4 historical SQL SOURCE inventory. Never opens a DB, executes
 * SQL, obtains receipts, or assigns a historical migration disposition.
 *
 * node scripts/generate-issue-1031-source-worksheet.mjs --write
 * node scripts/generate-issue-1031-source-worksheet.mjs --check
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseMigrationSql } from "./lib/issue-1031-sql-source-parser.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const path = name => resolve(ROOT, name);
const sourceHash = bytes => createHash("sha256").update(bytes).digest("hex");
const sort = arr => [...arr].sort((a, b) => a.localeCompare(b, "en"));
const unique = values => sort(new Set(values));
export const RECEIPT_FIELDS = Object.freeze([
  "receipt_found", "receipt_source", "applied_at", "applied_by",
  "checksum_matches_receipt", "disposition",
]);
export const MIGRATION_COLUMNS = Object.freeze([
  "file_path", "numeric_prefix", "sha256_exact_committed_bytes",
  "duplicate_prefix", "all_colliding_files", "canonical_per_history_guard",
  "history_guard_reference", "statement_types", "statement_count",
  "creates_objects", "touches_objects", "source_schema_objects",
  "objects_not_in_source_schema", "runtime_only_ddl_candidates",
  "requires_tables", "candidate_prior_source_files_not_receipts",
  "unresolved_source_dependencies", "hazards", "manual_review_flags",
  ...RECEIPT_FIELDS,
]);
export const TABLE_COLUMNS = Object.freeze([
  "schema_table", "numbered_files_creating_table", "unnumbered_baseline_creates_table",
  "runtime_compatibility_create_sources", "runtime_only_without_numbered_migration",
  "defining_file_disposition", "production_absent_name_independently_attested",
]);
const GUARD_CITATION = "scripts/check-sql-migration-history.mjs:10-16; scripts/lib/migration-receipt-audit.mjs:11-35";
const NONE_CANONICAL = "NONE - history guard retains collisions and selects no canonical file";

function schemaTables() {
  // Same TypeScript AST approach as existing issue-1031-schema-manifest.ts.
  const source = readFileSync(path("src/db/schema.ts"), "utf8");
  const sf = ts.createSourceFile("src/db/schema.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) throw Error("SCHEMA_TYPESCRIPT_PARSE_FAILED");
  const names = new Set();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "pgTable") {
      const name = node.arguments[0];
      if (!name || !ts.isStringLiteral(name) || names.has(name.text)) throw Error("DUPLICATE_OR_DYNAMIC_SCHEMA_TABLE");
      names.add(name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  // 271 at the original inventory, two #641 tables in 0135, and one F-04 history
  // table in 0137. Source count is not evidence of any production DDL apply.
  if (names.size !== 274) throw Error("EXPECTED_274_SOURCE_TABLES_FOUND_" + names.size);
  return sort(names);
}

function runtimeSources() {
  // This is a conservative scan of runtime SQL DDL candidates from the exact
  // historical helper list. Dynamic SQL is separately flagged, not certified.
  const docs = readFileSync(path("docs/engineering/runtime-schema-writer-audit.md"), "utf8");
  const names = unique(["src/lib/core-schema-compat.ts", ...[...docs.matchAll(/src\/lib\/[a-z0-9-]+\.ts/g)].map(m => m[0])]);
  const tables = new Map();
  for (const filename of names) {
    if (!existsSync(path(filename))) throw Error("RUNTIME_WRITER_SOURCE_MISSING_" + filename);
    const content = readFileSync(path(filename), "utf8");
    // Conservative static source-text scan: candidates can include comments,
    // and dynamic SQL is not proven. The DBA must inspect each cited helper.
    const re = /\bCREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(?:public\.)?([a-z_][a-z_0-9]*))/gi;
    for (const match of content.matchAll(re)) {
      const name = match[1] || match[2];
      tables.set(name, unique([...(tables.get(name) ?? []), filename]));
    }
  }
  return tables;
}

function fileSources() {
  const entries = readdirSync(path("drizzle"), { withFileTypes: true })
    .filter(e => e.isFile() && !e.isSymbolicLink()).map(e => e.name);
  if (entries.length !== readdirSync(path("drizzle")).length) throw Error("NONFILE_DRIZZLE_ENTRY");
  const files = sort(entries).map(filename => {
    const name = "drizzle/" + filename, bytes = readFileSync(path(name));
    if (!/^(?:[0-9]{4}_[a-z0-9_-]+\.sql|baseline\.sql|README\.md)$/.test(filename)) {
      throw Error("UNCLASSIFIED_DRIZZLE_FILE_" + filename);
    }
    const prefix = /^(\d{4})_/.exec(filename)?.[1] ?? "";
    return { path: name, prefix, sha256: sourceHash(bytes), sql: filename.endsWith(".sql"),
      parsed: filename.endsWith(".sql") ? parseMigrationSql(bytes.toString("utf8")) : null };
  });
  // Forward-only sources 0128 through 0138
  // extend the pinned SOURCE inventory; never use this count as a receipt.
  if (files.length !== 154) throw Error("EXPECTED_154_DRIZZLE_FILES_FOUND_" + files.length);
  for (const pathSuffix of [
    "drizzle/0128_recovery_foreign_key_names_forward.sql",
    "drizzle/0129_non_recovery_fk_names_forward.sql",
    "drizzle/0130_worksite_assignment_decision_forward.sql",
    "drizzle/0131_separation_record_forward_repair.sql",
    "drizzle/0132_filing_remittance_evidence_forward.sql",
    "drizzle/0133_audit_missing_foundation_forward.sql",
    "drizzle/0134_wfm_demand_missing_foundation_forward.sql",
    "drizzle/0135_salary_correction_cases.sql",
    "drizzle/0136_statutory_payment_evidence_one_active.sql",
    "drizzle/0137_immutable_payroll_calculation_history.sql",
    "drizzle/0138_labor_vertical_dimensions.sql",
  ]) if (files.filter(row => row.path === pathSuffix && row.sql).length !== 1)
    throw Error("FORWARD_SOURCE_MISSING_FROM_PINNED_INVENTORY_" + pathSuffix);
  return files;
}

const pipe = a => unique(a).join(" | ");
function csvValue(value) {
  const string = String(value ?? "");
  return '"' + string.replaceAll('"', '""') + '"';
}
const toCsv = (columns, rows) => [columns, ...rows.map(row => columns.map(key => row[key] ?? ""))]
  .map(values => values.map(csvValue).join(",")).join("\n") + "\n";

export function generateSourceWorksheet() {
  const schema = schemaTables(), schemaSet = new Set(schema);
  const files = fileSources(), runtime = runtimeSources();
  const numbered = files.filter(f => f.prefix);
  const groups = new Map();
  for (const file of numbered) groups.set(file.prefix, [...(groups.get(file.prefix) ?? []), file.path]);
  const duplicatePrefixes = sort([...groups.keys()].filter(k => groups.get(k).length > 1));
  if (duplicatePrefixes.length !== 13) throw Error("EXPECTED_13_LEGACY_COLLISIONS_FOUND_" + duplicatePrefixes.length);
  const known = "0021 0024 0026 0027 0030 0031 0039 0049 0065 0082 0086 0092 0093".split(" ");
  if (duplicatePrefixes.join(",") !== known.join(",")) throw Error("KNOWN_COLLISION_SET_CHANGED");
  const creators = new Map();
  for(const file of files.filter(f => f.sql)) for(const table of file.parsed.creates) {
    creators.set(table, [...(creators.get(table) ?? []), file]);
  }
  const tableRows = schema.map(name => {
    const defining = (creators.get(name) ?? []).filter(f => f.prefix);
    const baseline = (creators.get(name) ?? []).some(f => f.path === "drizzle/baseline.sql");
    const runtimeFiles = runtime.get(name) ?? [];
    return {
      schema_table: name,
      numbered_files_creating_table: pipe(defining.map(f => f.path)),
      unnumbered_baseline_creates_table: baseline ? "yes - source snapshot only" : "no",
      runtime_compatibility_create_sources: pipe(runtimeFiles),
      runtime_only_without_numbered_migration: runtimeFiles.length && defining.length === 0 ? "yes - static source candidate; human review" : "",
      defining_file_disposition: defining.length ? "numbered source definition(s) only - application unproven" :
        "defined only in schema.ts / no migration creates it",
      production_absent_name_independently_attested: "",
    };
  });
  const fileRows = files.map(file => {
    const parsed = file.parsed;
    const touched = parsed?.objects ?? [], required = parsed?.requires ?? [];
    const external = required.filter(t => !parsed.creates.includes(t));
    // Prefix order supplies *candidate provenance* only; never execution order.
    const candidatePrior = new Set(), unresolved = new Set();
    for (const table of external) {
      const candidate = (creators.get(table) ?? []).filter(other => other.prefix &&
        file.prefix && Number(other.prefix) < Number(file.prefix));
      for (const prior of candidate) candidatePrior.add(prior.path);
      if (!candidate.length) unresolved.add(table + " - no proven earlier numbered source");
    }
    const runtimeOnly = touched.filter(t => runtime.has(t) &&
      !(creators.get(t) ?? []).some(f => f.prefix));
    const collision = file.prefix ? (groups.get(file.prefix) ?? []) : [];
    return {
      file_path:file.path, numeric_prefix:file.prefix, sha256_exact_committed_bytes:file.sha256,
      duplicate_prefix:collision.length > 1 ? "yes" : "no",
      all_colliding_files:collision.length > 1 ? pipe(collision) : "",
      canonical_per_history_guard:collision.length > 1 ? NONE_CANONICAL : "",
      history_guard_reference:collision.length > 1 ? GUARD_CITATION : "",
      statement_types:pipe(parsed?.statementTypes ?? ["NON_SQL_SOURCE"]),
      statement_count:parsed?.statementCount ?? "",
      creates_objects:pipe(parsed?.creates ?? []),
      touches_objects:pipe(touched),
      source_schema_objects:pipe(touched.filter(t => schemaSet.has(t))),
      objects_not_in_source_schema:pipe(touched.filter(t => !schemaSet.has(t))),
      runtime_only_ddl_candidates:pipe(runtimeOnly),
      requires_tables:pipe(external),
      candidate_prior_source_files_not_receipts:pipe(candidatePrior),
      unresolved_source_dependencies:pipe(unresolved),
      hazards:pipe(parsed?.hazards ?? []),
      manual_review_flags:pipe(parsed?.review ?? []),
      ...Object.fromEntries(RECEIPT_FIELDS.map(field => [field, ""])),
    };
  });
  const mapped = tableRows.filter(r => r.numbered_files_creating_table).length;
  const withoutDefining = tableRows.length - mapped;
  const runtimeOnly = tableRows.filter(r => r.runtime_only_without_numbered_migration).map(r => r.schema_table);
  const ambiguities = {
    duplicatePrefixes:duplicatePrefixes.map(prefix => ({prefix,files:groups.get(prefix)})),
    runtimeOnlyTables:runtimeOnly,
    runtimeOnlyFiles:unique([...runtimeOnly].flatMap(t => runtime.get(t) ?? [])),
    destructiveFiles:fileRows.filter(r => r.hazards).map(r => ({file:r.file_path,flags:r.hazards})),
    proceduralOrUnclassifiedFiles:fileRows.filter(r => /PROCEDURAL|UNCLASSIFIED|DYNAMIC/.test(r.manual_review_flags)).map(r=>r.file_path),
  };
  const summary = {
    kind:"source-only-issue-1031-historical-worksheet",
    totalDrizzleFiles:files.length, numberedSqlFiles:numbered.length, sqlFiles:files.filter(f=>f.sql).length,
    duplicatePrefixGroups:duplicatePrefixes.length,
    sourceSchemaTables:schema.length, tablesMappedToNumberedSource:mapped,
    tablesWithoutNumberedCreate:withoutDefining,
    receiptFieldsPopulated:0, productionConnected:false, productionApplicationProven:false,
    sourceOnly:true, releaseApproved:false,
  };
  return { summary, ambiguities, migrationCsv:toCsv(MIGRATION_COLUMNS,fileRows),tableCsv:toCsv(TABLE_COLUMNS,tableRows),migrationRows:fileRows,tableRows };
}
const mode = process.argv[2];
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!["--write","--check","--summary","--ambiguities"].includes(mode) || process.argv.length !== 3)
      throw Error("USAGE_WRITE_CHECK_SUMMARY_OR_AMBIGUITIES_ONLY");
    const result = generateSourceWorksheet();
    const outputs = {
      "docs/engineering/issue-1031-migration-source-worksheet.csv":result.migrationCsv,
      "docs/engineering/issue-1031-source-table-crosswalk.csv":result.tableCsv,
    };
    for (const [filename, contents] of Object.entries(outputs)) {
      if(mode === "--write") writeFileSync(path(filename), contents);
      else if(mode === "--check" && (!existsSync(path(filename)) || readFileSync(path(filename), "utf8") !== contents))
        throw Error("STALE_OR_INCOMPLETE_WORKSHEET_" + basename(filename));
    }
    console.log(JSON.stringify(mode === "--ambiguities" ? result.ambiguities : result.summary, null, 2));
  } catch (error) {
    console.error("ISSUE_1031_SOURCE_WORKSHEET_FAILED: " + String(error?.message ?? "unknown"));
    process.exitCode = 1;
  }
}
