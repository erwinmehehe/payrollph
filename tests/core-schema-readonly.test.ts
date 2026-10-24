import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  coreSchemaCompatibilityMode,
  verifyCoreSchemaReadOnly,
  type CatalogQuery,
} from "../src/lib/core-schema-readonly";
import {
  requiredReleaseColumns,
  requiredReleaseTables,
  requiredReleaseIndexes,
  type ReleaseIndexMetadata,
} from "../src/lib/production-schema-inventory";

function indexRows(): ReleaseIndexMetadata[] {
  return [
    {
      name: "saas_billing_one_open_checkout",
      tableName: "saas_billing_checkouts",
      isUnique: true, isValid: true, isReady: true,
      keys: ["organization_id"],
      predicate: "status IN ('creating','awaiting_payment','review_required')",
    },
    {
      name: "audit_events_chain_seq_unique",
      tableName: "audit_events",
      isUnique: true, isValid: true, isReady: true,
      keys: ["coalesce(organization_id, 0)", "chain_seq"],
      predicate: "(chain_seq IS NOT NULL)",
    },
    {
      name: "provider_events_provider_event_id_unique",
      tableName: "provider_events",
      isUnique: true, isValid: true, isReady: true,
      keys: ["provider", "event_id"], predicate: null,
    },
    {
      name: "comp_automation_intent_key_unique",
      tableName: "compensation_automation_intents",
      isUnique: true, isValid: true, isReady: true,
      keys: ["organization_id", "trigger", "event_key"], predicate: null,
    },
  ];
}

function fixture(overrides: {
  tables?: readonly string[];
  columns?: readonly string[];
  indexes?: ReleaseIndexMetadata[];
  readOnly?: boolean;
  failAt?: string;
} = {}) {
  const calls: string[] = [];
  const query: CatalogQuery = async (sql) => {
    calls.push(sql);
    if (overrides.failAt && sql.includes(overrides.failAt)) {
      throw new Error("synthetic catalog unavailable");
    }
    if (sql.includes("current_setting('transaction_read_only')")) {
      return { rows: [{ ready: overrides.readOnly !== false }] };
    }
    if (sql.includes("pg_catalog.pg_attribute")) {
      return { rows: (overrides.columns ?? requiredReleaseColumns).map(name => ({ name })) };
    }
    if (sql.includes("pg_catalog.pg_index")) {
      return { rows: (overrides.indexes ?? indexRows()) as unknown as Record<string, unknown>[] };
    }
    if (sql.includes("pg_catalog.pg_trigger")) {
      return { rows: [{ name: "audit_events.audit_events_protect_mutation" }] };
    }
    if (sql.includes("pg_catalog.pg_proc")) return { rows: [{ present: true }] };
    if (sql.includes("pg_catalog.pg_class")) {
      return { rows: (overrides.tables ?? requiredReleaseTables).map(name => ({ name })) };
    }
    return { rows: [] }; // transaction and local settings
  };
  return { query, calls };
}

test("flag-off mode selection preserves the existing production and developer contract", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    for (const runtime of [{ NODE_ENV: "production", VERCEL: "1" }, { NODE_ENV: "development" }]) {
      const env = { ...runtime, REQUEST_SCHEMA_READONLY_ENABLED: flag };
      assert.deepEqual([undefined, "legacy", "read-only"].map(value => coreSchemaCompatibilityMode(value, env)),
        ["legacy", "legacy", "read-only"]);
      for (const value of ["", "readOnly", "READ-ONLY", "apply", "repair", "off", " true "])
        assert.throws(() => coreSchemaCompatibilityMode(value, env),
          /Invalid CORE_SCHEMA_COMPATIBILITY_MODE; refusing runtime schema writes/);
    }
  }
});

test("flag-on read-only cutover rejects legacy even in a spoofed GitHub fixture environment", () => {
  for (const runtime of [{ NODE_ENV: "production", VERCEL: "1" }, {
    CI: "true", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "erwinmehehe/payrollph",
    RUNNER_ENVIRONMENT: "github-hosted", GITHUB_RUN_ID: "39089717368",
    GITHUB_EVENT_NAME: "pull_request", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  }]) {
    const env = { ...runtime, REQUEST_SCHEMA_READONLY_ENABLED: "true" };
    assert.equal(coreSchemaCompatibilityMode(undefined, env), "read-only");
    assert.equal(coreSchemaCompatibilityMode("read-only", env), "read-only");
    for (const value of ["legacy", "", "readOnly", "READ-ONLY", "apply", "repair", "off", " true "])
      assert.throws(() => coreSchemaCompatibilityMode(value, env),
        /CORE_SCHEMA_COMPATIBILITY_MODE_LEGACY_RUNTIME_DDL_FORBIDDEN/);
  }
});

test("core compatibility no longer contains a runtime table creator", () => {
  const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  assert.doesNotMatch(source, /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i);
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b|pg_advisory_xact_lock/i);
  assert.ok(source.includes("await verifyCoreSchemaReadOnly("));
  assert.ok(!source.includes("backfillBankDataEncryption"));
  assert.ok(!source.includes("backfillGovernmentIdEncryption"));
});

test("read-only catalog preconditions pass with all required release structures, never mutate", async () => {
  const { query, calls } = fixture();
  await verifyCoreSchemaReadOnly(query);
  assert.equal(calls[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(calls.some(sql => sql.includes("pg_catalog.pg_index")));
  assert.ok(calls.some(sql => sql.includes("pg_catalog.pg_attribute")));
  for (const sql of calls) {
    assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|COMMIT)\b/i);
  }
});

test("missing tables, columns and nonunique indexes block readiness with rollback", async () => {
  const cases = [
    { tables: requiredReleaseTables.filter(name => name !== "provider_events") },
    { columns: requiredReleaseColumns.filter(name => name !== "audit_events.chain_seq") },
    { indexes: indexRows().map(row =>
      row.name === "provider_events_provider_event_id_unique"
        ? { ...row, isUnique: false } : row) },
  ];
  for (const overrides of cases) {
    const { query, calls } = fixture(overrides);
    await assert.rejects(() => verifyCoreSchemaReadOnly(query),
      /CORE_SCHEMA_READONLY_PRECONDITION_FAILED/);
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});

test("a missing read-only transaction or a catalog exception fails closed and rolls back", async () => {
  for (const overrides of [{ readOnly: false }, { failAt: "pg_catalog.pg_attribute" }]) {
    const { query, calls } = fixture(overrides);
    await assert.rejects(() => verifyCoreSchemaReadOnly(query));
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});

test("failed ROLLBACK cannot produce a successful readiness signal", async () => {
  const { query, calls } = fixture();
  await assert.rejects(() => verifyCoreSchemaReadOnly(async (sql, params) => {
    if (sql === "ROLLBACK") throw new Error("synthetic rollback failure");
    return query(sql, params);
  }), /synthetic rollback failure/);
  assert.ok(calls.some(sql => sql.includes("pg_catalog.pg_index")),
    "catalog validation must execute before rollback rejection");
});

test("dashboard and demo always use the catalog-only core compatibility gate", () => {
  const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  const dashboard = readFileSync("src/lib/dashboard-data.ts", "utf8");
  const demo = readFileSync("src/app/api/auth/demo-switch/route.ts", "utf8");
  assert.ok(source.includes("coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE)"));
  assert.ok(source.includes("await verifyCoreSchemaReadOnly("));
  assert.ok(source.includes("client?.release(!verifiedAndRolledBack)"),
    "failed catalog verification or rollback must discard the pooled connection");
  assert.ok(!source.includes('if (mode === "read-only")'),
    "even flag-off legacy selection must not invoke runtime DDL");
  assert.ok(dashboard.includes("await ensureCoreCompatibilitySchema()"));
  assert.ok(demo.includes("await ensureCoreCompatibilitySchema()"));
});

test("core readiness caches only successful read-only checks and never backfills", () => {
  const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  assert.match(source, /let coreSchemaReadOnlyReady = false/);
  assert.match(source, /let coreSchemaReadOnlyInFlight: Promise<void> \| null = null/);
  assert.ok(source.indexOf("coreSchemaCompatibilityMode(") <
    source.indexOf("if (coreSchemaReadOnlyReady) return"),
    "mode validation must run before consulting the cache");
  assert.ok(source.indexOf("await verifyCoreSchemaReadOnly(") <
    source.indexOf("coreSchemaReadOnlyReady = true"));
  assert.match(source, /coreSchemaReadOnlyInFlight = null/);
  assert.ok(source.includes("client?.release(!verifiedAndRolledBack)"));
  assert.doesNotMatch(source, /backfill(?:BankData|GovernmentId)Encryption/);
  assert.ok(!source.includes("let coreSchemaReady"));
  assert.ok(!source.includes("coreSchemaInFlight"));
});
