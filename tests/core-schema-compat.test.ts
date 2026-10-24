import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { verifyCoreSchemaReadOnly, type CatalogQuery } from "../src/lib/core-schema-readonly";
import { requiredReleaseColumns, requiredReleaseTables } from "../src/lib/production-schema-inventory";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("core compatibility delegates only to the catalog in every release mode", () => {
  const source = read("src/lib/core-schema-compat.ts");
  assert.ok(source.includes("coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE)"),
    "mode validation must still enforce REQUEST_SCHEMA_READONLY_ENABLED");
  assert.ok(source.includes("await verifyCoreSchemaReadOnly("));
  assert.ok(source.indexOf("coreSchemaCompatibilityMode(") < source.indexOf("if (coreSchemaReadOnlyReady)"),
    "an already-verified cache must not bypass flag-on legacy-mode rejection");
  assert.ok(!source.includes('if (mode === "read-only")'),
    "flag-off legacy mode cannot select the removed DDL branch");
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s+(?:TABLE|INDEX|INTO|FROM|[a-z_])/i);
  assert.doesNotMatch(source, /pg_advisory_xact_lock|backfillBankDataEncryption|backfillGovernmentIdEncryption/);
});

test("missing a required core table rejects readiness and rolls back without a repair", async () => {
  const statements: string[] = [];
  const query: CatalogQuery = async (sql) => {
    statements.push(sql);
    if (sql.includes("current_setting('transaction_read_only')"))
      return { rows: [{ ready: true }] };
    if (sql.includes("pg_catalog.pg_class"))
      return { rows: requiredReleaseTables.filter(name => name !== "provider_events").map(name => ({ name })) };
    if (sql.includes("pg_catalog.pg_attribute"))
      return { rows: requiredReleaseColumns.map(name => ({ name })) };
    if (sql.includes("pg_catalog.pg_index")) return { rows: [
      { name: "saas_billing_one_open_checkout", tableName: "saas_billing_checkouts",
        isUnique: true, isValid: true, isReady: true, keys: ["organization_id"],
        predicate: "status IN ('creating','awaiting_payment','review_required')" },
      { name: "audit_events_chain_seq_unique", tableName: "audit_events",
        isUnique: true, isValid: true, isReady: true,
        keys: ["coalesce(organization_id, 0)", "chain_seq"], predicate: "(chain_seq IS NOT NULL)" },
      { name: "provider_events_provider_event_id_unique", tableName: "provider_events",
        isUnique: true, isValid: true, isReady: true,
        keys: ["provider", "event_id"], predicate: null },
      { name: "comp_automation_intent_key_unique", tableName: "compensation_automation_intents",
        isUnique: true, isValid: true, isReady: true,
        keys: ["organization_id", "trigger", "event_key"], predicate: null },
    ] };
    if (sql.includes("pg_catalog.pg_trigger"))
      return { rows: [{ name: "audit_events.audit_events_protect_mutation" }] };
    if (sql.includes("pg_catalog.pg_proc"))
      return { rows: [{ present: true }] };
    return { rows: [] };
  };

  await assert.rejects(() => verifyCoreSchemaReadOnly(query),
    /CORE_SCHEMA_READONLY_PRECONDITION_FAILED/);
  assert.equal(statements[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.ok(statements.some(sql => sql.includes("pg_catalog.pg_class")));
  for (const sql of statements)
    assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|COMMIT)\b/i);
});

test("bank encryption readiness checks ciphertext without modifying data", () => {
  const source = read("src/lib/core-schema-compat.ts");
  const bank = source.slice(source.indexOf("export async function bankDataEncryptionReady()"),
    source.indexOf("/**", source.indexOf("export async function bankDataEncryptionReady()")));
  assert.ok(bank.includes("await ensureCoreCompatibilitySchema()"),
    "bank readiness cannot skip the fail-closed catalog preflight");
  assert.ok(bank.indexOf("await ensureCoreCompatibilitySchema()") < bank.indexOf("pool.query"),
    "the database must be structurally ready before bank-data inspection");
  assert.ok(bank.includes("bank_account NOT LIKE 'enc:v1:%'"));
  assert.ok(bank.includes("trace #>> '{payment,bankAccount}'"));
  assert.doesNotMatch(bank, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  assert.ok(!source.includes("encryptBankAccount(") && !source.includes("encryptGovernmentId("),
    "data encryption backfills belong in a separately reviewed migration");
});

test("demo launch and authenticated dashboard still gate database reads on core verification", () => {
  const demo = read("src/app/api/auth/demo-switch/route.ts");
  const dashboard = read("src/lib/dashboard-data.ts");
  assert.ok(demo.includes("await ensureCoreCompatibilitySchema()"));
  assert.ok(demo.includes("await preparePublicDemoTenant()"));
  assert.ok(demo.includes("await ensurePublicDemoTenant()"));
  assert.ok(demo.indexOf("await ensureCoreCompatibilitySchema()") <
    demo.indexOf("await preparePublicDemoTenant()"));
  assert.ok(dashboard.indexOf("await ensureCoreCompatibilitySchema()") <
    dashboard.indexOf("await ensureSeedData()"));
});

test("core verification caches only success, coalesces checks and discards unsafe clients", () => {
  const source = read("src/lib/core-schema-compat.ts");
  assert.match(source, /let coreSchemaReadOnlyReady = false/);
  assert.match(source, /let coreSchemaReadOnlyInFlight: Promise<void> \| null = null/);
  assert.ok(source.indexOf("await verifyCoreSchemaReadOnly(") <
    source.indexOf("coreSchemaReadOnlyReady = true"));
  assert.ok(source.includes("coreSchemaReadOnlyInFlight = null"));
  assert.ok(source.includes("client?.release(!verifiedAndRolledBack)"),
    "failed verification or ROLLBACK must discard the pooled client");
});
