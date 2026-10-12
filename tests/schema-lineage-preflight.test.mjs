import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_MODERN_SCHEMA_COLUMNS,
  MODERN_SCHEMA_LINEAGE_SQL,
  evaluateModernSchemaLineage,
  assertModernSchemaLineage,
} from "../scripts/lib/schema-lineage-preflight.mjs";

const matches = () => REQUIRED_MODERN_SCHEMA_COLUMNS.map(([tableName, columnName]) => ({
  tableName, columnName, matchesExpectedType: true,
}));

test("current organization_id/integer-id schema fingerprint is compatible", async () => {
  const rows = matches();
  const result = evaluateModernSchemaLineage(rows);
  assert.equal(result.compatible, true);
  assert.equal(result.expectedColumns, 9);
  assert.equal(result.incompatibleColumns, 0);
  assert.equal(result.inspectedTenantOrBankRows, false);
  assert.equal(result.permitsLegacyInPlaceConversion, false);
  await assert.doesNotReject(assertModernSchemaLineage({
    async query(sql) {
      assert.equal(sql, MODERN_SCHEMA_LINEAGE_SQL);
      return { rows };
    },
  }));
  assert.match(MODERN_SCHEMA_LINEAGE_SQL, /pg_catalog\.pg_attribute/);
  assert.doesNotMatch(MODERN_SCHEMA_LINEAGE_SQL, /\bFROM public\.(?:employees|payroll_runs|payroll_entries)\b/i);
});

test("old Neon UUID/client_id lineage explicitly fails before migration planning", async () => {
  const rows = matches().map(row => ({
    ...row,
    matchesExpectedType: !(
      row.tableName === "organizations" ||
      row.tableName === "employees" ||
      row.tableName === "payroll_runs" ||
      row.tableName === "payroll_entries" ||
      row.tableName === "payout_transfers" ||
      row.tableName === "provider_events"
    ),
  }));
  assert.equal(evaluateModernSchemaLineage(rows).compatible, false);
  await assert.rejects(
    assertModernSchemaLineage({ query: async () => ({ rows }) }),
    /REVIEWED_MIGRATION_LEGACY_SCHEMA_INCOMPATIBLE/,
  );
});

test("bad PostgreSQL metadata, duplicate rows and missing columns fail closed", () => {
  const rows = matches();
  for (const corrupt of [
    [],
    rows.slice(1),
    [...rows, rows[0]],
    rows.map((r, i) => i === 0 ? { ...r, tableName: "typo" } : r),
    rows.map((r, i) => i === 0 ? { ...r, matchesExpectedType: null } : r),
  ]) {
    assert.throws(() => evaluateModernSchemaLineage(corrupt),
      /REVIEWED_MIGRATION_LINEAGE_METADATA_UNVERIFIED/);
  }
});
