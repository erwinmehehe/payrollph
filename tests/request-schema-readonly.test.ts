import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Pool } from "pg";
import {
  leaveSchemaSpec, payBasisSchemaSpec,
  payrollMonthCloseSchemaSpec, doleReportingSchemaSpec, separationSchemaSpec,
  marketingLeadSchemaSpec, marketingLeadSchemaForRuntime, workforceAttendanceSchemaSpec,
  migrationSchemaSpec, outboxDeliverySchemaSpec, statutoryCorrectionSchemaSpec,
  statutoryMonthCloseSchemaSpec, verifyRequestSchemaReadOnlyFromPool, cachedRequestSchemaVerifier,
  verifyRequestSchemaReadOnly,
  type RequestSchemaSpec,
  type RequestCatalogQuery,
} from "../src/lib/request-schema-readonly";

type Variant = {
  missingTable?: string; missingColumn?: string; columnType?: string;
  missingDefault?: string; wrongDefault?: string; wrongIndexKeys?: string;
  weakIndex?: string; wrongIndexTable?: string; wrongIndexDefinition?: string;
  missingConstraint?: boolean;
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
        indexDefinition: i.name === variant.wrongIndexDefinition
          ? "CREATE INDEX test ON public." + i.tableName +
            " USING btree (" + i.keys.join(", ") + ")" // intentionally missing DESC
          : "CREATE INDEX test ON public." + i.tableName +
            " USING btree (" + (i.definitionTokens?.join(" ") ?? i.keys.join(", ")) + ")",
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

test("sibling schema helpers contain no request-time DDL or backfill and only verify the catalog", () => {
  // tests/runtime-schema-audit.test.mjs separately requires zero audited writers in these files.
  for (const file of [
    "src/lib/dole-reporting-schema.ts", "src/lib/leave-payroll-schema.ts", "src/lib/migration-schema.ts",
    "src/lib/outbox-schema.ts", "src/lib/pay-basis-schema.ts", "src/lib/payroll-month-close-schema.ts",
    "src/lib/separation-schema.ts", "src/lib/statutory-remittance-correction-schema.ts",
    "src/lib/statutory-remittance-month-close-schema.ts", "src/lib/workforce-attendance-control-schema.ts",
    "src/lib/marketing-leads.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.ok(!source.includes("coreSchemaCompatibilityMode"), file + ": no legacy mode switch remains");
    assert.ok(!/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|UNIQUE INDEX)\b/i.test(source), file);
    assert.ok(!/pg_advisory_xact_lock/.test(source), file + ": no legacy DDL lock remains");
    assert.ok(/cachedRequestSchemaVerifier\(pool, \w+SchemaSpec\)|verifyRequestSchemaReadOnlyFromPool\(pool,/.test(source),
      file + ": the helper must delegate to the catalog verifier");
  }
  const pay = readFileSync("src/lib/pay-basis-schema.ts", "utf8");
  const profiles = pay.slice(pay.indexOf("export async function ensureEmployeePayProfiles"));
  assert.ok(profiles.includes("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"));
  assert.ok(profiles.includes("LEFT JOIN employee_pay_profiles p"));
  assert.ok(profiles.includes("WHERE e.organization_id = $1"));
  assert.ok(profiles.includes("READONLY_PAY_PROFILES_REQUIRE_REVIEWED_BACKFILL"));
  assert.ok(!/INSERT\s+INTO\s+employee_pay_profiles/i.test(profiles), "missing pay profiles are never silently invented");
  assert.ok(profiles.includes("client?.release(!rolledBack)"));
});

test("cached catalog verifier checks once, shares in-flight checks and never caches a failure", async () => {
  let connects = 0;
  let fail = true;
  const released: boolean[] = [];
  const pool = {
    async connect() {
      connects += 1;
      const { query } = simulate(leaveSchemaSpec, fail ? { transactionReadOnly: false } : {});
      return { query, release: (destroy?: boolean) => { released.push(Boolean(destroy)); } };
    },
  } as unknown as Pool;
  const check = cachedRequestSchemaVerifier(pool, leaveSchemaSpec);
  await assert.rejects(() => check());
  assert.deepEqual(released, [true], "a failed check discards its pooled client");
  fail = false;
  await Promise.all([check(), check(), check()]);
  assert.equal(connects, 2, "concurrent callers share one in-flight check after the failure");
  await check();
  assert.equal(connects, 2, "a passed check is cached for the process");
  assert.deepEqual(released, [true, false]);
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

test("separation read-only failure and ROLLBACK errors propagate", async () => {
  for (const drift of [
    { transactionReadOnly: false },
    { failAt: "pg_catalog.pg_constraint" },
    { rollbackFails: true },
  ]) {
    const { query, calls } = simulate(separationSchemaSpec, drift);
    await assert.rejects(() => verifyRequestSchemaReadOnly(query, separationSchemaSpec));
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});

const newlyGuardedSpecs: RequestSchemaSpec[] = [
  marketingLeadSchemaSpec, workforceAttendanceSchemaSpec, migrationSchemaSpec,
  outboxDeliverySchemaSpec, statutoryCorrectionSchemaSpec, statutoryMonthCloseSchemaSpec,
];

test("marketing index check: flag on is canonical-only, flag off accepts canonical or historical", async () => {
  const canonical = marketingLeadSchemaForRuntime({ REQUEST_SCHEMA_READONLY_ENABLED: "true" });
  // A database whose indexes were created by the retired runtime DDL.
  const historical = {
    ...marketingLeadSchemaSpec,
    indexes: marketingLeadSchemaSpec.indexes.map(index => ({
      ...index,
      definitionTokens: index.definitionTokens?.map(token => token.replace(" DESC)", " DESC NULLS LAST)")),
    })),
  };
  for (const flag of [undefined, "false", "", "TRUE"]) {
    const flagOff = marketingLeadSchemaForRuntime({ REQUEST_SCHEMA_READONLY_ENABLED: flag });
    // Nothing can repair these indexes at runtime any more, so both real shapes pass.
    await verifyRequestSchemaReadOnly(simulate(canonical).query, flagOff);
    await verifyRequestSchemaReadOnly(simulate(historical).query, flagOff);
  }
  await verifyRequestSchemaReadOnly(simulate(canonical).query, canonical);
  await assert.rejects(() => verifyRequestSchemaReadOnly(simulate(historical).query, canonical),
    /REQUEST_SCHEMA_READONLY_MARKETING_INCOMPATIBLE/);
  assert.equal(canonical, marketingLeadSchemaSpec, "flag-off calls cannot mutate the canonical contract");
});

test("marketing index preflight matches schema.ts and numbered SQL, not legacy NULLS LAST DDL", async () => {
  const canonical = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0024_marketing_leads.sql", "utf8");
  const expected = [
    ["marketing_leads_status_created_idx", "status"],
    ["marketing_leads_kind_created_idx", "kind"],
  ] as const;
  for (const [name, firstColumn] of expected) {
    assert.ok(canonical.includes(
      `index("${name}").on(table.${firstColumn}, table.createdAt.desc().nullsFirst())`,
    ), name + " must use canonical Drizzle DESC ordering");
    assert.ok(migration.includes(
      `ON marketing_leads(${firstColumn}, created_at DESC);`,
    ), name + " must match numbered migration ordering");
    const index = marketingLeadSchemaSpec.indexes.find(row => row.name === name);
    assert.deepEqual(index?.definitionTokens, [`(${firstColumn}, created_at DESC)`]);
    assert.ok(!index?.definitionTokens?.some(token => token.includes("NULLS LAST")));
  }
  const { query, calls } = simulate(marketingLeadSchemaSpec,
    { wrongIndexDefinition: "marketing_leads_status_created_idx" });
  await assert.rejects(() => verifyRequestSchemaReadOnly(query, marketingLeadSchemaSpec),
    /REQUEST_SCHEMA_READONLY_MARKETING_INCOMPATIBLE/);
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("remaining request-time schema catalog checks are read-only and rollback cleanly", async () => {
  for (const spec of newlyGuardedSpecs) {
    const { query, calls } = simulate(spec);
    await verifyRequestSchemaReadOnly(query, spec);
    assert.equal(calls[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY", spec.label);
    assert.equal(calls.at(-1), "ROLLBACK", spec.label);
    assert.ok(calls.some(sql => sql.includes("pg_catalog.pg_attribute")), spec.label);
    for (const sql of calls) {
      assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|COMMIT)\b/i);
    }
  }
});

test("unverified request-time schemas cannot bypass catalog or constraint checks", async () => {
  for (const spec of newlyGuardedSpecs) {
    const scenarios: Variant[] = [
      { missingTable: spec.tables[0] },
      { missingColumn: spec.columns[0].name },
      { columnType: spec.columns.find(c => c.type)?.name },
      ...(spec.indexes.length ? [{ wrongIndexKeys: spec.indexes[0].name }] : []),
      ...(spec.indexes.some(i => i.definitionTokens?.length)
        ? [{ wrongIndexDefinition: spec.indexes.find(i => i.definitionTokens?.length)?.name }] : []),
      ...(spec.constraints.length ? [{ missingConstraint: true }] : []),
      ...(spec.columns.some(c => c.defaultTextLiteral !== undefined)
        ? [{ wrongDefault: spec.columns.find(c => c.defaultTextLiteral !== undefined)?.name }] : []),
    ];
    for (const scenario of scenarios) {
      const { query, calls } = simulate(spec, scenario);
      await assert.rejects(
        () => verifyRequestSchemaReadOnly(query, spec),
        /REQUEST_SCHEMA_READONLY_.*_INCOMPATIBLE/,
        spec.label + " " + JSON.stringify(scenario),
      );
      assert.equal(calls.at(-1), "ROLLBACK");
    }
  }
});

test("pooled catalog preflight discards failed or unrolled-back connections", async () => {
  for (const outcome of ["pass", "schema-missing", "rollback-failed"]) {
    const discarded: boolean[] = [];
    const { query } = simulate(migrationSchemaSpec,
      outcome === "schema-missing" ? { missingTable: "historical_payroll_entries" }
        : outcome === "rollback-failed" ? { rollbackFails: true } : {});
    const fakePool = {
      connect: async () => ({
        query,
        release(discard: boolean) { discarded.push(discard); },
      }),
    } as unknown as Pool;
    if (outcome === "pass") {
      await verifyRequestSchemaReadOnlyFromPool(fakePool, migrationSchemaSpec);
    } else {
      await assert.rejects(() => verifyRequestSchemaReadOnlyFromPool(fakePool, migrationSchemaSpec));
    }
    assert.deepEqual(discarded, [outcome !== "pass"], outcome);
  }
});
