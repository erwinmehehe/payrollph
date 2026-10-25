import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceBaselineParity } from "../scripts/lib/source-baseline-parity.mjs";

const source = [
  { name: "organizations", columns: [{ name: "id" }, { name: "name" }] },
  { name: "payroll_runs", columns: [{ name: "id" }, { name: "gross_pay" }] },
];
const catalog = [
  { table_name: "organizations", column_name: "id" },
  { table_name: "organizations", column_name: "name" },
  { table_name: "payroll_runs", column_name: "id" },
  { table_name: "payroll_runs", column_name: "gross_pay" },
];

test("checks every source table and column, preserving migration-only objects as visibility", () => {
  const result = assertSourceBaselineParity(source, [
    ...catalog,
    { table_name: "organizations", column_name: "migration_only_setting" },
    { table_name: "audit_chain_heads", column_name: "id" },
  ]);
  assert.equal(result.sourceTables, 2);
  assert.equal(result.sourceColumns, 4);
  assert.deepEqual(result.unmodeledColumns, ["organizations.migration_only_setting"]);
  assert.deepEqual(result.migrationOrBaselineOnlyTables, ["audit_chain_heads"]);
  assert.equal(result.productionCertified, false);
});

test("missing source table fails even when a different extra table exists", () => {
  assert.throws(
    () => assertSourceBaselineParity(source, catalog.filter((x) => x.table_name !== "payroll_runs")),
    /SOURCE_BASELINE_MISSING.*payroll_runs/
  );
});

test("missing column fails; adding a catalog column cannot mask the gap", () => {
  assert.throws(
    () => assertSourceBaselineParity(source, [
      ...catalog.filter((x) => x.column_name !== "gross_pay"),
      { table_name: "payroll_runs", column_name: "other" },
    ]),
    /SOURCE_BASELINE_MISSING.*payroll_runs.gross_pay/
  );
});

test("duplicate source and catalog names fail before any misleading count can pass", () => {
  assert.throws(() => assertSourceBaselineParity([...source, source[0]], catalog), /DUPLICATE_OR_EMPTY_TABLE/);
  assert.throws(() => assertSourceBaselineParity(source, [...catalog, catalog[0]]), /DUPLICATE_CATALOG_COLUMN/);
  assert.throws(() => assertSourceBaselineParity([], catalog), /INVALID_INPUT/);
  assert.throws(() => assertSourceBaselineParity(source, [{ table_name: "", column_name: "x" }]), /INVALID_CATALOG_TABLE/);
  assert.throws(() => assertSourceBaselineParity(source, [{ table_name: "organizations", column_name: "" }]), /INVALID_CATALOG_COLUMN/);
  assert.throws(() => assertSourceBaselineParity(source, [{ table_name: "organizations", column_name: "x\0y" }]), /INVALID_CATALOG_COLUMN/);
});

test("PostgreSQL quoted/mixed-case identifiers compare by exact name, never snake-case filtered", () => {
  const columns = ["MiXeD", "worker$dollars", "holiday.date", "taux appliqué", "space name"];
  const declared = [{ name: "Quoted.Table", columns: columns.map((name) => ({ name })) }];
  const actual = columns.map((column_name) => ({ table_name: "Quoted.Table", column_name }));
  const summary = assertSourceBaselineParity(declared, actual);
  assert.equal(summary.sourceTables, 1);
  assert.equal(summary.sourceColumns, 5);
  assert.deepEqual(summary.unmodeledColumns, []);
  assert.throws(
    () => assertSourceBaselineParity(declared, actual.map((row) =>
      row.column_name === "MiXeD" ? { ...row, column_name: "mixed" } : row
    )),
    /SOURCE_BASELINE_MISSING.*MiXeD/,
    "case mismatches must fail instead of being folded or ignored"
  );
});

test("empty or null-byte names are rejected, not silently skipped", () => {
  const invalid = [{ name: "organizations", columns: [{ name: "" }] }];
  assert.throws(() => assertSourceBaselineParity(invalid, catalog), /INVALID_COLUMN/);
  assert.throws(() => assertSourceBaselineParity([
    { name: "organizations\0suffix", columns: [{ name: "id" }] },
  ], catalog), /INVALID_TABLE/);
});
