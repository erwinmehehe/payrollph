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

test("all retained core CREATE TABLE targets have canonical Drizzle declarations", () => {
  // Name-level guard only: catalog/index/FK parity and deployment receipts
  // remain separate DBA checks. Legacy SQL must not be run by requests.
  const legacy = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const created = [...legacy.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?([a-z_][a-z0-9_]*)"?\s*\(/gi)]
    .map(match => match[1]);
  const declared = new Set([...schema.matchAll(/pgTable\(\s*"([a-z_][a-z0-9_]*)"/gi)]
    .map(match => match[1]));
  assert.ok(created.length >= 50, "must inspect the whole historical core creator");
  assert.deepEqual(created.filter(name => !declared.has(name)), [],
    "historical core table identifiers cannot drift beyond src/db/schema.ts");
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

test("dashboard and demo are still gated through the shared compatibility helper", () => {
  const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  const dashboard = readFileSync("src/lib/dashboard-data.ts", "utf8");
  const demo = readFileSync("src/app/api/auth/demo-switch/route.ts", "utf8");
  assert.ok(source.includes('coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE)'));
  assert.ok(source.includes('if (mode === "read-only")'));
  assert.ok(source.indexOf('if (mode === "read-only")') <
    source.indexOf('await client.query("BEGIN")'),
    "read-only mode must run before any legacy schema transaction");
  assert.ok(source.includes('await verifyCoreSchemaReadOnly('));
  assert.ok(source.includes('client?.release(!verifiedAndRolledBack)'),
    "failed read-only verification must discard the pooled connection");
  assert.ok(dashboard.includes("await ensureCoreCompatibilitySchema()"));
  assert.ok(demo.includes("await ensureCoreCompatibilitySchema()"));
});


test("read-only core readiness is independent of cached legacy DDL and cannot backfill secrets", () => {
  const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  assert.match(source, /let coreSchemaReadOnlyReady = false/);
  assert.match(source, /let coreSchemaReadOnlyInFlight: Promise<void> \| null = null/);
  assert.ok(source.indexOf('if (mode === "read-only")') < source.indexOf('if (coreSchemaReady) return'),
    "legacy readiness cache must not bypass a new read-only catalog check");
  assert.match(source, /coreSchemaReadOnlyReady = true/);
  assert.match(source, /coreSchemaReadOnlyInFlight = null/);
  assert.match(source, /CORE_SCHEMA_LEGACY_MIGRATION_INFLIGHT/);
  for (const name of [
    "CORE_SCHEMA_READONLY_BANK_BACKFILL_FORBIDDEN",
    "CORE_SCHEMA_READONLY_GOVERNMENT_ID_BACKFILL_FORBIDDEN",
  ]) assert.ok(source.includes(name), name);
  assert.ok(source.includes("client?.release(!safeToReuse)"),
    "aborted or indeterminate compatibility DDL transactions must discard the pool client");
  assert.ok(source.includes('await client.query("ROLLBACK")'),
    "legacy migration failure still requires rollback");
});
