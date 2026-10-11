import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  leaveSchemaSpec, payBasisSchemaSpec,
  verifyRequestSchemaReadOnly,
  type RequestSchemaSpec,
  type RequestCatalogQuery,
} from "../src/lib/request-schema-readonly";

type Variant = {
  missingTable?: string; missingColumn?: string; columnType?: string;
  weakIndex?: string; wrongIndexTable?: string; missingConstraint?: boolean;
  transactionReadOnly?: boolean; failAt?: string; rollbackFails?: boolean;
};

function simulate(spec: RequestSchemaSpec, variant: Variant = {}) {
  const calls: string[] = [];
  const query: RequestCatalogQuery = async (sql) => {
    calls.push(sql);
    if (variant.rollbackFails && sql === "ROLLBACK") throw new Error("ROLLBACK_FAILED");
    if (variant.failAt && sql.includes(variant.failAt)) throw new Error("CATALOG_UNAVAILABLE");
    if (sql.includes("current_setting('transaction_read_only')")) {
      return { rows: [{ ready: variant.transactionReadOnly !== false }] };
    }
    if (sql.includes("pg_catalog.pg_attribute")) return {
      rows: spec.columns.filter(c => c.name !== variant.missingColumn).map(c => ({
        name: c.name,
        type: c.name === variant.columnType ? "text" : c.type,
        notNull: c.notNull,
      })),
    };
    if (sql.includes("pg_catalog.pg_index")) return {
      rows: spec.indexes.map(i => ({
        name: i.name, tableName: i.name === variant.wrongIndexTable ? "payroll_runs" : i.tableName,
        isUnique: i.name === variant.weakIndex ? false : i.unique,
        isValid: true, isReady: true,
        keys: [...i.keys],
        predicate: i.predicateTokens?.length ? i.predicateTokens.join(" ") : null,
      })),
    };
    if (sql.includes("pg_catalog.pg_constraint")) return {
      rows: spec.constraints.slice(variant.missingConstraint ? 1 : 0).map(c => ({
        tableName: c.tableName, kind: c.kind, definition: c.tokens.join(" "),
      })),
    };
    if (sql.includes("pg_catalog.pg_class")) return {
      rows: spec.tables.filter(table => table !== variant.missingTable).map(name => ({ name })),
    };
    return { rows: [] };
  };
  return { query, calls };
}

test("leave and pay-basis read-only catalogs complete without any mutation or employer-row read", async () => {
  for (const spec of [leaveSchemaSpec, payBasisSchemaSpec]) {
    const { query, calls } = simulate(spec);
    await verifyRequestSchemaReadOnly(query, spec);
    assert.equal(calls[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    assert.equal(calls.at(-1), "ROLLBACK");
    assert.ok(calls.some(q => q.includes("pg_catalog.pg_index")));
    assert.ok(calls.some(q => q.includes("pg_catalog.pg_constraint")));
    assert.ok(calls.some(q => q.includes("pg_catalog.pg_attribute")));
    for (const sql of calls) {
      assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|COMMIT)\b/i);
      assert.doesNotMatch(sql, /FROM\s+employees\b|FROM\s+leave_requests\b/i);
    }
  }
});

test("missing tables or columns, invalid money type, missing FK and substituted index are blockers", async () => {
  const cases: Array<[RequestSchemaSpec, Variant]> = [
    [leaveSchemaSpec, { missingTable: "leave_request_intervals" }],
    [leaveSchemaSpec, { missingColumn: "leave_policies.paid_percentage" }],
    [leaveSchemaSpec, { columnType: "leave_policies.paid_percentage" }],
    [leaveSchemaSpec, { weakIndex: "leave_interval_set_current_unique" }],
    [leaveSchemaSpec, { wrongIndexTable: "leave_interval_set_current_unique" }],
    [leaveSchemaSpec, { missingConstraint: true }],
    [payBasisSchemaSpec, { missingTable: "employee_pay_retro_adjustments" }],
    [payBasisSchemaSpec, { missingColumn: "employee_pay_revisions.effective_date" }],
    [payBasisSchemaSpec, { columnType: "employee_pay_profiles.rate_amount" }],
    [payBasisSchemaSpec, { weakIndex: "employee_pay_revisions_employee_effective_idx" }],
    [payBasisSchemaSpec, { missingConstraint: true }],
  ];
  for (const [spec, bad] of cases) {
    const { query, calls } = simulate(spec, bad);
    await assert.rejects(() => verifyRequestSchemaReadOnly(query, spec),
      /REQUEST_SCHEMA_READONLY_.*_INCOMPATIBLE/, JSON.stringify(bad));
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});

test("database transaction not read-only or failed catalog lookup always rolls back", async () => {
  for (const change of [{ transactionReadOnly: false }, { failAt: "pg_catalog.pg_constraint" }]) {
    const { query, calls } = simulate(payBasisSchemaSpec, change);
    await assert.rejects(() => verifyRequestSchemaReadOnly(query, payBasisSchemaSpec));
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});

test("a failed rollback is propagated so a caller discards the connection", async () => {
  const { query, calls } = simulate(leaveSchemaSpec, { rollbackFails: true });
  await assert.rejects(() => verifyRequestSchemaReadOnly(query, leaveSchemaSpec), /ROLLBACK_FAILED/);
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("legacy DDL modules use shared opt-in mode before any schema DDL", () => {
  for (const file of ["src/lib/leave-payroll-schema.ts", "src/lib/pay-basis-schema.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes("coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE)"));
    assert.ok(source.includes('if (mode === "read-only")'));
    assert.ok(source.includes("verifyRequestSchemaReadOnly("));
    assert.ok(source.includes("client?.release(!verified)"));
    assert.ok(source.indexOf('if (mode === "read-only")') <
      source.indexOf('await client.query("BEGIN")'),
      "the schema inspection must precede any DDL transaction");
  }
  const pay = readFileSync("src/lib/pay-basis-schema.ts", "utf8");
  const backfill = pay.slice(pay.indexOf("export async function ensureEmployeePayProfiles"));
  assert.ok(backfill.includes("LEFT JOIN employee_pay_profiles p"));
  assert.ok(backfill.includes("WHERE e.organization_id = $1"));
  assert.ok(backfill.includes("READONLY_PAY_PROFILES_REQUIRE_REVIEWED_BACKFILL"));
  assert.ok(backfill.indexOf('if (mode === "read-only")') <
    backfill.indexOf("INSERT INTO employee_pay_profiles"),
    "legacy pay profile INSERT may only run in explicit legacy mode");
  assert.ok(backfill.includes("client?.release(!rolledBack)"));
});
