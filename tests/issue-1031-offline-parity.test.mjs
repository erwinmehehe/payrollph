import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOfflineReport, parseOfflineExport, OFFLINE_EXPORT_END } from "../scripts/lib/issue-1031-offline-parity.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(join(ROOT,
  "tests/fixtures/issue-1031-offline/fictional-catalog.json"), "utf8"));
assert.equal(fixture.fictionalOnly, true);
const clone = value => structuredClone(value);
const historical = () => [{migrationPath: fixture.inventory[0].path,
  sha256: fixture.inventory[0].sha256, disposition: "applied"}];
function snapshot(kind, rows = clone(fixture.catalog), receipts = historical(), applied = []) {
  if (kind === "disposable-pg18") { receipts = []; applied = []; }
  return {
    formatVersion:2,
    exportKind:kind,
    postgresMajor:18,
    catalogRows:rows,
    catalogRowCount:rows.length,
    tableCount:rows.filter(row => row.kind === "table").length,
    historicalReceipts:receipts,
    appliedMigrations:applied,
    journalRowCount:receipts.length + applied.length,
    completed:OFFLINE_EXPORT_END,
  };
}
function report(production, reference = snapshot("disposable-pg18")) {
  return buildOfflineReport(reference, production, {files:fixture.inventory});
}
function has(output, kind, change, category) {
  return output.differences.some(r => r.kind === kind && r.change === change && r.category === category);
}
test("fictional identical exports: zero diffs, no claimed production certification", () => {
  const result = report(snapshot("production"));
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.BLOCKING, 0);
  assert.equal(result.productionCertified, false);
  assert.equal(result.referenceBuildNotAuthenticated, true);
  assert.match(result.certification, /NOT PRODUCTION IN GENERAL/);
});
test("fictional missing column is BLOCKING", () => {
  const rows = clone(fixture.catalog).filter(r => r.object_name !== "amount");
  const result = report(snapshot("production", rows));
  assert.ok(has(result, "column", "MISSING", "BLOCKING"));
});
test("fictional type mismatch is BLOCKING", () => {
  const rows = clone(fixture.catalog);
  rows.find(r => r.object_name === "amount").details.type = "numeric(12,2)";
  assert.ok(has(report(snapshot("production", rows)), "column", "DRIFT", "BLOCKING"));
});
test("fictional nullability mismatch is BLOCKING", () => {
  const rows = clone(fixture.catalog);
  rows.find(r => r.object_name === "amount").details.nullable = true;
  const result = report(snapshot("production", rows));
  assert.ok(has(result, "column", "DRIFT", "BLOCKING"));
  assert.ok(result.differences.find(d => d.change === "DRIFT").fields.includes("nullable"));
});
test("fictional missing index is BLOCKING", () => {
  const rows = clone(fixture.catalog).filter(r => r.kind !== "index");
  assert.ok(has(report(snapshot("production", rows)), "index", "MISSING", "BLOCKING"));
});
test("PG18 index DESC, NULLS FIRST, INCLUDE, storage, tablespace and NULLS NOT DISTINCT drift block", () => {
  const cases = [
    ["DESC order", "key_desc", [true], "keys"],
    ["NULLS FIRST", "key_nulls_first", [true], "keys"],
    ["included column", "include", ["id"], "include"],
    ["storage option", "options", ["fillfactor=70"], "options"],
    ["tablespace", "tablespace", "other_space", "tablespace"],
    ["NULLS NOT DISTINCT", "nulls_not_distinct", true, "nullsNotDistinct"],
  ];
  for (const [label, field, value, signatureField] of cases) {
    const rows = clone(fixture.catalog);
    rows.find(row => row.kind === "index").details[field] = value;
    const drift = report(snapshot("production", rows)).differences.find(
      item => item.kind === "index" && item.change === "DRIFT" && item.category === "BLOCKING");
    assert.ok(drift, label + " must block");
    assert.ok(drift.fields.includes(signatureField), label + " must identify changed signature field");
  }
});
test("missing or malformed advanced PG18 index export fields fail closed", () => {
  const missing = snapshot("production");
  delete missing.catalogRows.find(row => row.kind === "index").details.key_desc;
  assert.throws(() => report(missing), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
  const malformed = snapshot("production");
  malformed.catalogRows.find(row => row.kind === "index").details.key_nulls_first = [0];
  assert.throws(() => report(malformed), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
});

test("fictional extra table and column are INFORMATIONAL", () => {
  const rows = clone(fixture.catalog);
  rows.push({table_name:"fictional_legacy",kind:"table",object_name:"fictional_legacy",details:{}});
  rows.push({table_name:"fictional_legacy",kind:"column",object_name:"id",
    details:{type:"integer",nullable:false,default:null,identity:null}});
  const result = report(snapshot("production", rows));
  assert.ok(has(result, "table", "EXTRA", "INFORMATIONAL"));
  assert.ok(has(result, "column", "EXTRA", "INFORMATIONAL"));
});
test("repo migration omitted from both journals requires owner decision", () => {
  const result = report(snapshot("production", clone(fixture.catalog), []));
  assert.ok(has(result, "migration", "REPO_FILE_WITHOUT_JOURNAL_ROW", "NEEDS-OWNER-DECISION"));
});
test("fictional journal source hash mismatch is BLOCKING", () => {
  const receipt = historical();
  receipt[0].sha256 = "2".repeat(64);
  assert.ok(has(report(snapshot("production", clone(fixture.catalog), receipt)),
    "migration", "CHECKSUM_MISMATCH", "BLOCKING"));
});
test("truncated, missing marker, wrong count and unexpected payload fail closed", () => {
  const production = snapshot("production");
  assert.throws(() => report('{"formatVersion":1'), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
  assert.throws(() => report({...production,completed:""}), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
  assert.throws(() => report({...production,catalogRowCount:1}), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
  assert.throws(() => report({...production,customerRows:[]}), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
});
test("orphan rows, duplicate objects, bad journal and missing columns fail closed", () => {
  const prod = snapshot("production");
  prod.catalogRows.push({...clone(fixture.catalog[0])});
  prod.catalogRowCount++;
  assert.throws(() => report(prod), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
  const another = snapshot("production");
  another.historicalReceipts = [{migrationPath:"employees.csv",sha256:"1".repeat(64),disposition:"applied"}];
  assert.throws(() => report(another), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
  const empty = snapshot("production", [clone(fixture.catalog[0])]);
  assert.throws(() => report(empty), /OFFLINE_EXPORT_INVALID_OR_INCOMPLETE/);
});
test("CLI refuses malformed private JSON without writing report or using a DB", () => {
  const temp = mkdtempSync(join(tmpdir(), "fictional-1031-"));
  try {
    const ref = join(temp, "ref.json"), prod = join(temp, "prod.json");
    const out = join(temp, "out.json");
    writeFileSync(ref, JSON.stringify(snapshot("disposable-pg18")));
    writeFileSync(prod, '{"truncated":');
    const proc = spawnSync(process.execPath,
      [join(ROOT,"scripts/qa/issue-1031-compare-offline.mjs"),
        "--reference",ref,"--production",prod,"--report",out],
      {encoding:"utf8",cwd:ROOT,timeout:10000});
    assert.equal(proc.status, 2);
    assert.equal(existsSync(out), false);
    assert.doesNotMatch(proc.stderr, /postgresql:\/\//);
  } finally { rmSync(temp,{force:true,recursive:true}); }
});
test("CLI refuses symlinked catalog input, without writing a report", () => {
  if (process.platform === "win32") return;
  const temp = mkdtempSync(join(tmpdir(), "fictional-1031-symlink-"));
  try {
    const ref = join(temp, "ref.json"), prod = join(temp, "prod.json");
    const linked = join(temp, "linked-prod.json"), out = join(temp, "out.json");
    writeFileSync(ref, JSON.stringify(snapshot("disposable-pg18")));
    writeFileSync(prod, JSON.stringify(snapshot("production")));
    symlinkSync(prod, linked);
    const proc = spawnSync(process.execPath,
      [join(ROOT, "scripts/qa/issue-1031-compare-offline.mjs"),
        "--reference", ref, "--production", linked, "--report", out],
      {encoding:"utf8", cwd:ROOT, timeout:10000});
    assert.equal(proc.status, 2);
    assert.equal(existsSync(out), false);
  } finally { rmSync(temp, {force:true,recursive:true}); }
});

test("SQL printer reuses catalog query and never opens a DB", () => {
  const tsx = join(ROOT, "node_modules/.bin/tsx");
  if (!existsSync(tsx)) return; // dedicated CI installs dependencies first
  for (const kind of ["--production","--disposable-pg18"]) {
    const result = spawnSync(tsx,
      [join(ROOT,"scripts/issue-1031-offline-export-sql.ts"),kind],
      {encoding:"utf8",cwd:ROOT,timeout:15000});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
    assert.match(result.stdout, /ROLLBACK;/);
    assert.match(result.stdout, /pg_catalog\.pg_class/);
    assert.match(result.stdout, /ind\.indoption/);
    assert.match(result.stdout, /idx\.reloptions/);
    assert.match(result.stdout, /ind\.indnullsnotdistinct/);
    assert.match(result.stdout, /'formatVersion', 2/);
    assert.doesNotMatch(result.stdout, /postgresql:\/\/|NEON_DATABASE_URL|PRODUCTION_DATABASE_URL/);
    if (kind === "--production") assert.match(result.stdout, /payrollph_schema_migrations/);
  }
});
