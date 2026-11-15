/**
 * #1031 offline-only snapshot validation and comparison.
 * No DB client, socket, migration executor or schema writer is imported.
 * Reuses the existing #1386 / #1605 / #1613 structural ratchets.
 */
import { assertSourceBaselineParity, assertSourceBaselineConstraintParity } from "./source-baseline-parity.mjs";

export const OFFLINE_EXPORT_END = "ISSUE_1031_CATALOG_EXPORT_COMPLETE_V2";
const KINDS = new Set(["table", "column", "primary_key", "foreign_key", "unique_constraint", "check", "index"]);
const CATEGORIES = ["BLOCKING", "INFORMATIONAL", "NEEDS-OWNER-DECISION"];
const PATH = /^drizzle\/[0-9]{4}_[a-z0-9][a-z0-9_-]*\.sql$/;
const SHA = /^[0-9a-f]{64}$/;
const FIELDS = {
  table: [],
  column: ["type", "nullable", "default", "identity"],
  primary_key: ["columns", "nulls_not_distinct", "validated"],
  foreign_key: ["columns", "ref_table", "ref_columns", "on_delete", "on_update", "validated"],
  unique_constraint: ["columns", "nulls_not_distinct", "validated"],
  check: ["expression", "validated"],
  index: ["unique", "method", "keys", "predicate", "valid", "ready",
    "key_desc", "key_nulls_first", "include", "options", "tablespace", "nulls_not_distinct"],
};
const TOP = ["formatVersion", "exportKind", "postgresMajor", "catalogRows", "catalogRowCount",
  "tableCount", "historicalReceipts", "appliedMigrations", "journalRowCount", "completed"];

function fail() { throw new Error("OFFLINE_EXPORT_INVALID_OR_INCOMPLETE"); }
function object(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
function string(x) { return typeof x === "string" && x.length > 0 && !x.includes("\0"); }
function strings(x) { return Array.isArray(x) && x.every(string); }
function sameKeys(value, keys) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function validateDetails(kind, d) {
  if (!object(d) || !sameKeys(d, FIELDS[kind])) fail();
  if (kind === "table") return;
  if (kind === "column") {
    if (!string(d.type) || typeof d.nullable !== "boolean" ||
      !(d.default === null || typeof d.default === "string") ||
      !(d.identity === null || ["", "a", "d", "always", "byDefault"].includes(d.identity))) fail();
  }
  if (kind === "foreign_key" && (!strings(d.columns) || !string(d.ref_table) ||
    !strings(d.ref_columns) || !string(d.on_delete) || !string(d.on_update) ||
    typeof d.validated !== "boolean")) fail();
  if ((kind === "primary_key" || kind === "unique_constraint") &&
    (!strings(d.columns) || typeof d.validated !== "boolean" ||
     !(d.nulls_not_distinct === null || typeof d.nulls_not_distinct === "boolean"))) fail();
  if (kind === "check" && (!string(d.expression) || typeof d.validated !== "boolean")) fail();
  if (kind === "index" && (typeof d.unique !== "boolean" || !string(d.method) ||
    !strings(d.keys) || !(d.predicate === null || typeof d.predicate === "string") ||
    typeof d.valid !== "boolean" || typeof d.ready !== "boolean" ||
    !Array.isArray(d.key_desc) || !Array.isArray(d.key_nulls_first) ||
    d.key_desc.length !== d.keys.length || d.key_nulls_first.length !== d.keys.length ||
    !d.key_desc.every(v => typeof v === "boolean") ||
    !d.key_nulls_first.every(v => typeof v === "boolean") ||
    !strings(d.include) || !strings(d.options) ||
    !(d.tablespace === null || string(d.tablespace)) ||
    typeof d.nulls_not_distinct !== "boolean")) fail();
}
function journalRow(row, historical) {
  const fields = historical ? ["migrationPath", "sha256", "disposition"] : ["migrationPath", "sha256"];
  if (!object(row) || !sameKeys(row, fields) || !PATH.test(row.migrationPath) ||
    !SHA.test(row.sha256)) fail();
  if (historical && !["applied", "baseline-included", "not-applied"].includes(row.disposition)) fail();
}
export function parseOfflineExport(data, kind) {
  let value;
  try { value = typeof data === "string" ? JSON.parse(data) : data; } catch { fail(); }
  if (!object(value) || !sameKeys(value, TOP) || value.formatVersion !== 2 ||
    value.completed !== OFFLINE_EXPORT_END || value.exportKind !== kind ||
    !Number.isInteger(value.postgresMajor) || value.postgresMajor < 16 ||
    (kind === "disposable-pg18" && value.postgresMajor !== 18) ||
    !Array.isArray(value.catalogRows) ||
    !Array.isArray(value.historicalReceipts) || !Array.isArray(value.appliedMigrations) ||
    !Number.isSafeInteger(value.catalogRowCount) || !Number.isSafeInteger(value.tableCount) ||
    !Number.isSafeInteger(value.journalRowCount) ||
    value.catalogRows.length !== value.catalogRowCount ||
    value.historicalReceipts.length + value.appliedMigrations.length !== value.journalRowCount ||
    (kind === "disposable-pg18" && value.journalRowCount !== 0)) fail();
  const seen = new Set();
  const tables = new Set();
  let columns = 0;
  for (const row of value.catalogRows) {
    if (!object(row) || !sameKeys(row, ["table_name", "kind", "object_name", "details"]) ||
      !string(row.table_name) || !string(row.object_name) || !KINDS.has(row.kind)) fail();
    validateDetails(row.kind, row.details);
    const key = JSON.stringify([row.table_name, row.kind, row.object_name]);
    if (seen.has(key) || (row.kind === "table" && row.table_name !== row.object_name)) fail();
    seen.add(key);
    if (row.kind === "table") tables.add(row.table_name);
    if (row.kind === "column") columns++;
  }
  if (tables.size !== value.tableCount || tables.size === 0 || columns === 0 ||
    value.catalogRows.some(row => !tables.has(row.table_name))) fail();
  const journalPaths = new Set();
  for (const [list, historical] of [[value.historicalReceipts, true], [value.appliedMigrations, false]]) {
    const local = new Set();
    for (const row of list) {
      journalRow(row, historical);
      if (local.has(row.migrationPath)) fail();
      local.add(row.migrationPath);
      journalPaths.add(row.migrationPath);
    }
  }
  return value;
}
function flat(rows) {
  return rows.map(row => ({table_name: row.table_name, kind: row.kind,
    object_name: row.object_name, ...row.details}));
}
function referenceTables(reference) {
  const rows = flat(reference.catalogRows);
  const groups = new Map(rows.filter(r => r.kind === "table").map(r => [r.table_name, {
    name: r.table_name, columns: [], foreignKeys: [], indexes: [],
    checks: [], primaryKeys: [], uniqueConstraints: [],
  }]));
  const fields = {column:"columns", foreign_key:"foreignKeys", index:"indexes",
    check:"checks", primary_key:"primaryKeys", unique_constraint:"uniqueConstraints"};
  for (const row of rows) {
    if (row.kind === "table") continue;
    const target = groups.get(row.table_name);
    if (!target) fail();
    target[fields[row.kind]].push({...row, name: row.object_name});
  }
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name));
}
function captured(fn, prefix) {
  try { return fn(); } catch (e) {
    if (e instanceof Error && e.message.startsWith(prefix + " ")) {
      try { return JSON.parse(e.message.slice(prefix.length + 1)); } catch { fail(); }
    }
    throw e;
  }
}
function order(a,b) {
  return a.category.localeCompare(b.category) || a.table.localeCompare(b.table) ||
    a.kind.localeCompare(b.kind) || a.object.localeCompare(b.object);
}
export function buildOfflineReport(referenceInput, productionInput, inventory) {
  const reference = parseOfflineExport(referenceInput, "disposable-pg18");
  const production = parseOfflineExport(productionInput, "production");
  if (!Array.isArray(inventory?.files) || inventory.files.length === 0) fail();
  const model = referenceTables(reference);
  const productionRows = flat(production.catalogRows);
  const presence = captured(() =>
    assertSourceBaselineParity(model, productionRows.filter(r => r.kind === "column")
      .map(r => ({table_name:r.table_name, column_name:r.object_name}))),
    "SOURCE_BASELINE_MISSING");
  const structure = captured(() =>
    assertSourceBaselineConstraintParity(model, productionRows.filter(r => r.kind !== "table")),
    "SOURCE_BASELINE_CONSTRAINT_DRIFT");
  const found = new Map();
  function add(category, kind, table, object, change, fields = []) {
    if (!CATEGORIES.includes(category) || !string(kind) || !string(table) || !string(object)) fail();
    const key = JSON.stringify([kind,table,object,change]);
    found.set(key, {category, kind, table, object, change, fields});
  }
  for (const table of presence.missingTables || []) add("BLOCKING","table",table,table,"MISSING");
  for (const item of presence.missingColumns || []) {
    const idx = item.indexOf(".");
    if (idx < 0) fail();
    add("BLOCKING","column",item.slice(0,idx),item.slice(idx+1),"MISSING");
  }
  const suffix = [
    ["Columns","column"], ["PrimaryKeys","primary_key"], ["ForeignKeys","foreign_key"],
    ["UniqueConstraints","unique_constraint"], ["Checks","check"], ["Indexes","index"],
  ];
  for (const [name,kind] of suffix) {
    for (const item of structure["missing"+name] || []) add("BLOCKING",kind,item.table,item.name,"MISSING");
    for (const item of structure["drifted"+name] || []) {
      const fields = Object.keys(item.expected || {}).filter(key =>
        JSON.stringify(item.expected[key]) !== JSON.stringify(item.actual?.[key]));
      add("BLOCKING",kind,item.table,item.name,"DRIFT", fields);
    }
    for (const item of structure["unmodeled"+name] || [])
      add("INFORMATIONAL",kind,item.table,item.name,"EXTRA");
  }
  const expectedNames = new Set(model.map(t => t.name));
  for (const row of production.catalogRows) {
    if (!expectedNames.has(row.table_name))
      add("INFORMATIONAL",row.kind,row.table_name,row.object_name,"EXTRA");
  }
  const files = new Map();
  for (const item of inventory.files) {
    if (!PATH.test(item.path) || !SHA.test(item.sha256) || files.has(item.path)) fail();
    files.set(item.path, item.sha256);
  }
  const journal = [...production.historicalReceipts.map(x => ({...x, ledger:"historical"})),
    ...production.appliedMigrations.map(x => ({...x, ledger:"forward"}))];
  const received = new Map();
  for (const entry of journal) {
    const previous = received.get(entry.migrationPath);
    if (previous) add("BLOCKING","migration","drizzle",entry.migrationPath,"DUPLICATE_ACROSS_JOURNALS");
    received.set(entry.migrationPath, entry);
    if (!files.has(entry.migrationPath)) {
      add("NEEDS-OWNER-DECISION","migration","drizzle",entry.migrationPath,"JOURNAL_SOURCE_NOT_IN_REPO");
    } else if (files.get(entry.migrationPath) !== entry.sha256) {
      add("BLOCKING","migration","drizzle",entry.migrationPath,"CHECKSUM_MISMATCH");
    }
    if (entry.disposition === "not-applied")
      add("NEEDS-OWNER-DECISION","migration","drizzle",entry.migrationPath,"RECORDED_NOT_APPLIED");
  }
  for (const path of files.keys()) {
    if (!received.has(path))
      add("NEEDS-OWNER-DECISION","migration","drizzle",path,"REPO_FILE_WITHOUT_JOURNAL_ROW");
  }
  const differences = [...found.values()].sort(order);
  const counts = Object.fromEntries(CATEGORIES.map(c => [c,
    differences.filter(d => d.category === c).length]));
  return {
    formatVersion:2,
    evidenceScope:"CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL",
    summary:{...counts,total:differences.length,referenceTables:reference.tableCount,
      exportedProductionTables:production.tableCount,repoNumberedSqlFiles:files.size,
      historicalReceiptRows:production.historicalReceipts.length,
      forwardMigrationRows:production.appliedMigrations.length},
    differences,
    comparisonScope:"supplied exported catalog versus supplied disposable PG18 catalog, with source migration file hashes; no production database access by this comparator",
    certification:"ONLY THE TWO EXPORT FILES PROVIDED WERE COMPARED; NOT PRODUCTION IN GENERAL",
    referenceBuildNotAuthenticated:true,
    historicalJournalAuthenticityNotVerified:true,
    rlspolicyParityNotVerified:true,
    productionMigrationApproved:false,
    dbaReviewRequired:true,
    productionCertified:false,
    releaseApproved:false,
  };
}
