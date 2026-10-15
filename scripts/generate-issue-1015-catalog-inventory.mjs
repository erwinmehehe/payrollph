#!/usr/bin/env node
/**
 * #1015: Generate a catalog-only SQL report from checked-in migration sources.
 *
 * No database connection. No DDL or application-row queries. The generated
 * query is evidence of named-object presence, NEVER an execution receipt.
 * Scope intentionally frozen to source prefixes 0110 through 0124.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DIR = join(process.cwd(), "drizzle");
const NUMBERED = /^01(?:1[0-9]|2[0-4])_[a-z0-9][a-z0-9_-]*\.sql$/;
const TABLE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_]\w*)"?/gi;
const INDEX = /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_]\w*)"?\s+ON\s+(?:ONLY\s+)?(?:"?public"?\.)?"?([a-zA-Z_]\w*)"?/gi;
const INDEX_START = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_]\w*)"?/gi;

function requireTrustedLiteral(value) {
  if (typeof value !== "string" || !/^[a-z0-9_./-]+$/i.test(value)) {
    throw new Error("Untrusted migration object/path token");
  }
  return "'" + value + "'";
}

function inventory() {
  const files = readdirSync(SOURCE_DIR).filter(name => NUMBERED.test(name)).sort();
  if (files.length !== 15 ||
      files[0] !== "0110_provider_events_inbox.sql" ||
      files[files.length - 1] !== "0124_attendance_exception_forward_repair.sql") {
    throw new Error("Migration source scope changed; re-review before regeneration");
  }
  const entries = [];
  for (const name of files) {
    const prefix = name.slice(0, 4);
    const sourcePath = "drizzle/" + name;
    // Checked-in 0110-0124 SQL uses line comments; fail if block comments
    // appear, rather than incorrectly counting declarations within them.
    const raw = readFileSync(join(SOURCE_DIR, name), "utf8");
    if (raw.includes("/*") || raw.includes("\0")) {
      throw new Error("Migration requires an updated reviewed SQL parser: " + name);
    }
    const sql = raw.replace(/--[^\n]*/g, " ");
    for (const match of sql.matchAll(TABLE)) {
      entries.push({ prefix, sourcePath, kind:"table", table:match[1], name:match[1], unique:false });
    }
    const indexes = [...sql.matchAll(INDEX)];
    if (indexes.length !== [...sql.matchAll(INDEX_START)].length) {
      throw new Error("Unexpected index declaration format in " + name);
    }
    for (const match of indexes) {
      entries.push({
        prefix, sourcePath, kind:"index", table:match[3], name:match[2],
        unique:Boolean(match[1]),
      });
    }
  }
  const checkPath = "drizzle/0119_xendit_payout_provider.sql";
  for (const [table, name] of [
    ["payout_batches", "payout_batches_provider_check"],
    ["payout_transfers", "payout_transfers_status_check"],
    ["payout_batch_transfers", "payout_batch_transfers_status_check"],
    ["payout_profiles", "payout_profiles_default_method_check"],
  ]) {
    entries.push({prefix:"0119",sourcePath:checkPath,kind:"check",table,name,unique:false});
  }
  for (const name of ["enabled_modules", "module_navigation_mode"]) {
    entries.push({
      prefix:"0122",sourcePath:"drizzle/0122_tenant_module_disclosure.sql",
      kind:"column",table:"organizations",name,unique:false,
    });
  }
  const identifiers = entries.map(x=>[x.prefix,x.kind,x.table,x.name].join(":"));
  if (entries.length !== 169 || new Set(identifiers).size !== 169) {
    throw new Error("Expected 169 unique source-declared object checks; re-review source drift");
  }
  return entries.sort((a, b) =>
    a.prefix.localeCompare(b.prefix) ||
    a.kind.localeCompare(b.kind) ||
    a.table.localeCompare(b.table) ||
    a.name.localeCompare(b.name)
  );
}

function buildReadOnlySql(entries) {
  const records = entries.map(e =>
    "    (" + [e.prefix,e.sourcePath,e.kind,e.table,e.name]
      .map(requireTrustedLiteral).join(", ") + ", " + (e.unique ? "true" : "false") + ")"
  );
  return [
    "-- #1015 fixed-source, read-only catalog evidence for migrations 0110-0124.",
    "-- Generated locally from checked-in files; no database connection by generator.",
    "-- This SQL may query pg_catalog only. It never reads employee, payroll or bank rows.",
    "-- PRESENT is not an applied migration receipt, validated index definition,",
    "-- verified historical data transformation, signed approval or release clearance.",
    "WITH required(prefix,source_path,kind,parent_table,object_name,expected_unique) AS (",
    "  VALUES",
    records.join(",\n"),
    "), observed AS (",
    "  SELECT r.*,",
    "    CASE r.kind",
    "      WHEN 'table' THEN EXISTS (",
    "        SELECT 1 FROM pg_catalog.pg_class c",
    "        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
    "        WHERE n.nspname='public' AND c.relname=r.object_name AND c.relkind IN ('r','p')",
    "      )",
    "      WHEN 'index' THEN EXISTS (",
    "        SELECT 1 FROM pg_catalog.pg_index ix",
    "        JOIN pg_catalog.pg_class idx ON idx.oid=ix.indexrelid",
    "        JOIN pg_catalog.pg_class tbl ON tbl.oid=ix.indrelid",
    "        JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace",
    "        WHERE n.nspname='public' AND tbl.relname=r.parent_table",
    "          AND idx.relname=r.object_name AND ix.indisvalid AND ix.indisready",
    "          AND ix.indisunique=r.expected_unique",
    "      )",
    "      WHEN 'check' THEN EXISTS (",
    "        SELECT 1 FROM pg_catalog.pg_constraint co",
    "        JOIN pg_catalog.pg_class tbl ON tbl.oid=co.conrelid",
    "        JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace",
    "        WHERE n.nspname='public' AND tbl.relname=r.parent_table",
    "          AND co.conname=r.object_name AND co.contype='c' AND co.convalidated",
    "      )",
    "      WHEN 'column' THEN EXISTS (",
    "        SELECT 1 FROM pg_catalog.pg_attribute a",
    "        JOIN pg_catalog.pg_class tbl ON tbl.oid=a.attrelid",
    "        JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace",
    "        WHERE n.nspname='public' AND tbl.relname=r.parent_table",
    "          AND a.attname=r.object_name AND a.attnum>0 AND NOT a.attisdropped",
    "      )",
    "      ELSE false END AS present",
    "  FROM required r",
    ")",
    "SELECT prefix,source_path,",
    "  count(*)::integer AS objects_checked,",
    "  count(*) FILTER (WHERE present)::integer AS objects_present,",
    "  count(*) FILTER (WHERE NOT present)::integer AS objects_missing,",
    "  array_agg(kind||':'||parent_table||'.'||object_name ORDER BY kind,parent_table,object_name)",
    "    FILTER(WHERE NOT present) AS missing_examples,",
    "  'CATALOG_EVIDENCE_ONLY_NOT_HISTORICAL_RECEIPT_OR_RELEASE_APPROVAL'::text AS evidence_scope",
    "FROM observed GROUP BY prefix,source_path ORDER BY prefix,source_path;",
    "",
  ].join("\n");
}

if (process.argv.length !== 2) {
  throw new Error("Usage: node scripts/generate-issue-1015-catalog-inventory.mjs > /tmp/issue1015.sql");
}
process.stdout.write(buildReadOnlySql(inventory()));
