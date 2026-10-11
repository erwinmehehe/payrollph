import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  leaveSchemaSpec, payBasisSchemaSpec,
  payrollMonthCloseSchemaSpec, doleReportingSchemaSpec, separationSchemaSpec,
  verifyRequestSchemaReadOnly,
  type RequestSchemaSpec,
  type RequestCatalogQuery,
} from "../src/lib/request-schema-readonly";

type Variant = {
  missingTable?: string; missingColumn?: string; columnType?: string;
  missingDefault?: string; wrongDefault?: string; wrongIndexKeys?: string;
  weakIndex?: string; wrongIndexTable?: string; missingConstraint?: boolean;
  missingConstraintToken?: string; nullableColumn?: string;
  unvalidatedConstraintToken?: string; deferredConstraintToken?: string;
  weakenMakerChecker?: boolean; wrongCheckName?: boolean;
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
        notNull: c.name === variant.nullableColumn ? !c.notNull : c.notNull,
        columnDefault: c.name === variant.missingDefault ? null
          : c.name === variant.wrongDefault
            ? c.defaultNumericZero ? "'100'::numeric" : "'not_" + c.defaultTextLiteral + "'::character varying"
          : c.defaultNumericZero ? "'0'::numeric"
          : c.defaultTextLiteral !== undefined ? "'" + c.defaultTextLiteral + "'::character varying"
          : c.defaultTokens?.join(" ") ?? null,
      })),
    };
    if (sql.includes("pg_catalog.pg_index")) return {
      rows: spec.indexes.map(i => ({
        name: i.name, tableName: i.name === variant.wrongIndexTable ? "payroll_runs" : i.tableName,
        isUnique: i.name === variant.weakIndex ? false : i.unique,
        isValid: true, isReady: true,
        keys: i.name === variant.wrongIndexKeys ? ["organization_id"] : [...i.keys],
        predicate: i.predicateTokens?.length ? i.predicateTokens.join(" ") : null,
      })),
    };
    if (sql.includes("pg_catalog.pg_constraint")) return {
      rows: spec.constraints.slice(variant.missingConstraint ? 1 : 0)
        .filter(c => !variant.missingConstraintToken || !c.tokens.some(t => t.includes(variant.missingConstraintToken!)))
        .map(c => ({
          tableName: c.tableName, kind: c.kind,
          name: variant.wrongCheckName && c.exactCheckDefinition ? "unreviewed_check" : c.name,
          isValidated: !variant.unvalidatedConstraintToken ||
            !c.tokens.some(t => t.includes(variant.unvalidatedConstraintToken!)),
          isDeferrable: Boolean(variant.deferredConstraintToken &&
            c.tokens.some(t => t.includes(variant.deferredConstraintToken!))),
          definition: c.exactCheckDefinition
            ? c.exactCheckDefinition + (variant.weakenMakerChecker ? " OR TRUE" : "")
            : c.tokens.join(" "),
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


test("month-close and DOLE reporting structure has valid typed evidence, indexes and defaults", async () => {
  for (const spec of [payrollMonthCloseSchemaSpec, doleReportingSchemaSpec]) {
    const { query, calls } = simulate(spec);
    await verifyRequestSchemaReadOnly(query, spec);
    assert.equal(calls[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    assert.equal(calls.at(-1), "ROLLBACK");
    assert.ok(calls.some(sql => sql.includes("pg_catalog.pg_attrdef")));
    assert.ok(calls.some(sql => sql.includes("pg_catalog.pg_constraint")));
    assert.ok(calls.some(sql => sql.includes("pg_catalog.pg_index")));
    for (const sql of calls) {
      assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|COMMIT)\b/i);
    }
  }
});

test("month-close refuses absent legal employer, wrong evidence data type, weak index, or missing status default", async () => {
  const bad: Variant[] = [
    { missingTable: "payroll_month_closures" },
    { missingColumn: "payroll_month_closures.legal_entity_id" },
    { columnType: "payroll_month_closures.evidence_snapshot" },
    { weakIndex: "payroll_month_closure_snapshot_unique" },
    { wrongIndexKeys: "payroll_month_closure_status_idx" },
    { missingDefault: "payroll_month_closures.status" },
    { wrongDefault: "payroll_month_closures.status" },
    { missingConstraint: true },
  ];
  for (const item of bad) {
    const { query, calls } = simulate(payrollMonthCloseSchemaSpec, item);
    await assert.rejects(() => verifyRequestSchemaReadOnly(query, payrollMonthCloseSchemaSpec),
      /REQUEST_SCHEMA_READONLY_MONTH-CLOSE_INCOMPATIBLE/, JSON.stringify(item));
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});

test("DOLE report certification refuses incomplete metadata or per-employer unique index", async () => {
  const bad: Variant[] = [
    { missingTable: "dole_reporting_profiles" },
    { missingColumn: "dole_compliance_submissions.report_hash" },
    { columnType: "dole_compliance_submissions.report_year" },
    { missingDefault: "dole_compliance_submissions.status" },
    { wrongDefault: "dole_compliance_submissions.status" },
    { weakIndex: "dole_compliance_submission_snapshot_unique" },
    { wrongIndexTable: "dole_compliance_submission_snapshot_unique" },
    { missingConstraint: true },
  ];
  for (const item of bad) {
    const { query, calls } = simulate(doleReportingSchemaSpec, item);
    await assert.rejects(() => verifyRequestSchemaReadOnly(query, doleReportingSchemaSpec),
      /REQUEST_SCHEMA_READONLY_DOLE-REPORTING_INCOMPATIBLE/, JSON.stringify(item));
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});

test("payroll month-close and DOLE legacy writers honor read-only mode before DDL", () => {
  for (const file of [
    "src/lib/payroll-month-close-schema.ts",
    "src/lib/dole-reporting-schema.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes("coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE)"));
    assert.ok(source.includes('if (mode === "read-only")'));
    assert.ok(source.includes("verifyRequestSchemaReadOnly("));
    assert.ok(source.includes("client?.release(!verified)"));
    assert.ok(source.indexOf('if (mode === "read-only")') <
      source.indexOf('await client.query("BEGIN")'),
      "request-path DDL must not run in read-only mode");
  }
  const close = readFileSync("src/lib/payroll-month-close-schema.ts", "utf8");
  assert.ok(close.includes("UPDATE payroll_month_closures c"));
  assert.ok(close.includes("ALTER COLUMN legal_entity_id SET NOT NULL"));
  const dole = readFileSync("src/lib/dole-reporting-schema.ts", "utf8");
  assert.ok(dole.includes("CREATE TABLE IF NOT EXISTS dole_compliance_submissions"));
});


test("separation final-pay schema is catalog-complete without DDL or employee row access", async () => {
  const { query, calls } = simulate(separationSchemaSpec);
  await verifyRequestSchemaReadOnly(query, separationSchemaSpec);
  assert.equal(calls[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(calls.some(sql => sql.includes("pg_catalog.pg_constraint")));
  assert.equal(separationSchemaSpec.columns.filter(c =>
    c.name.startsWith("separation_records.") && !["organization_id","employee_id"].some(k => c.name.endsWith("." + k))).length, 18);
  for (const sql of calls) {
    assert.doesNotMatch(sql, /\b(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|COMMIT)\b/i);
    assert.doesNotMatch(sql, /FROM\s+separation_records\b/i);
  }
});

test("separation final-pay blocks missing/incorrect amounts, JSON snapshots and actor integrity", async () => {
  const cases: Variant[] = [
    { missingTable: "separation_records" },
    { missingColumn: "separation_records.thirteenth_entitlement" },
    { columnType: "separation_records.thirteenth_paid_ytd" },
    { columnType: "separation_records.basic_salary_earned_ytd" },
    { columnType: "separation_records.computation_snapshot" },
    { columnType: "separation_records.approved_at" },
    { nullableColumn: "separation_records.gross_final_pay" },
    { nullableColumn: "separation_records.prepared_by_user_id" },
    { missingDefault: "separation_records.computation_snapshot" },
    { missingDefault: "separation_records.thirteenth_entitlement" },
    { wrongDefault: "separation_records.thirteenth_entitlement" },
    { wrongDefault: "separation_records.basic_salary_earned_ytd" },
    { wrongIndexTable: "separation_records_org_status_idx" },
    { wrongIndexKeys: "separation_records_org_status_idx" },
    { missingConstraintToken: "prepared_by_user_id" },
    { missingConstraintToken: "approved_by_user_id" },
    { missingConstraintToken: "released_by_user_id" },
    { missingConstraintToken: "<>" },
    { unvalidatedConstraintToken: "<>" },
    { unvalidatedConstraintToken: "approved_by_user_id" },
    { deferredConstraintToken: "prepared_by_user_id" },
    { weakenMakerChecker: true },
    { wrongCheckName: true },
  ];
  for (const c of cases) {
    const { query, calls } = simulate(separationSchemaSpec, c);
    await assert.rejects(() => verifyRequestSchemaReadOnly(query, separationSchemaSpec),
      /REQUEST_SCHEMA_READONLY_SEPARATION_INCOMPATIBLE/,
      "Unexpectedly accepted separation drift: " + JSON.stringify(c));
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});

test("separation read-only failure and ROLLBACK errors propagate, and legacy DDL remains gated", async () => {
  for (const drift of [
    { transactionReadOnly: false },
    { failAt: "pg_catalog.pg_constraint" },
    { rollbackFails: true },
  ]) {
    const { query, calls } = simulate(separationSchemaSpec, drift);
    await assert.rejects(() => verifyRequestSchemaReadOnly(query, separationSchemaSpec));
    assert.equal(calls.at(-1), "ROLLBACK");
  }
  const source = readFileSync("src/lib/separation-schema.ts", "utf8");
  assert.ok(source.includes("coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE)"));
  assert.ok(source.includes('if (mode === "read-only")'));
  assert.ok(source.includes("verifyRequestSchemaReadOnly("));
  assert.ok(source.includes("client?.release(!verified)"));
  assert.ok(source.indexOf('if (mode === "read-only")') < source.indexOf('await client.query("BEGIN")'));
  assert.ok(source.includes("ALTER TABLE separation_records"),
    "Legacy mode retains its prior operation until DBA migration cutover");
  assert.ok(source.includes("client?.release(!safeToReuse)"),
    "legacy rollback failure must discard the possibly open pooled transaction");
  assert.ok(source.includes("separationSchemaPromise = null"),
    "failed legacy connection or DDL should be retried after remediation");
});
