import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateReleaseSchemaInventory,
  requiredReleaseTables,
  requiredReleaseColumns,
  requiredReleaseIndexes,
  requiredReleaseFunctions,
  requiredReleaseTriggers,
} from "../src/lib/production-schema-inventory";

function completeInventory() {
  return {
    tables: [...requiredReleaseTables],
    columns: [...requiredReleaseColumns],
    indexes: [...requiredReleaseIndexes],
    functions: [...requiredReleaseFunctions],
    triggers: [...requiredReleaseTriggers],
  };
}

test("read-only schema inventory recognizes all required current migration structures", () => {
  const result = evaluateReleaseSchemaInventory(completeInventory());
  assert.equal(result.schemaCompatible, true);
  assert.deepEqual(result.missing, {
    tables: [], columns: [], indexes: [], functions: [], triggers: [],
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.migrationReceiptsVerified, false);
  assert.equal(result.payrollGaApproved, false);
});

test("missing signup verification table blocks deployment rather than being repaired", () => {
  const inventory = completeInventory();
  inventory.tables = inventory.tables.filter((table) => table !== "saas_signup_verifications");
  const result = evaluateReleaseSchemaInventory(inventory);
  assert.equal(result.schemaCompatible, false);
  assert.deepEqual(result.missing.tables, ["saas_signup_verifications"]);
});

test("missing audit-chain columns, protection trigger or sealing routine block deployment", () => {
  const inventory = completeInventory();
  inventory.columns = inventory.columns.filter((col) => col !== "audit_events.row_hash");
  inventory.triggers = [];
  inventory.functions = [];
  const result = evaluateReleaseSchemaInventory(inventory);
  assert.equal(result.schemaCompatible, false);
  assert.deepEqual(result.missing.columns, ["audit_events.row_hash"]);
  assert.deepEqual(result.missing.functions, ["seal_audit_events(integer)"]);
  assert.deepEqual(result.missing.triggers, ["audit_events.audit_events_protect_mutation"]);
});

test("missing provider deduplication index blocks release", () => {
  const inventory = completeInventory();
  inventory.indexes = inventory.indexes.filter((idx) => idx !== "provider_events_provider_event_id_unique");
  assert.deepEqual(evaluateReleaseSchemaInventory(inventory).missing.indexes, ["provider_events_provider_event_id_unique"]);
});

test("schema preflight script executes catalog-only queries inside a read-only transaction", () => {
  const code = readFileSync("scripts/check-production-schema-preflight.ts", "utf8");
  assert.match(code, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
  assert.match(code, /pg_catalog\.pg_class/);
  assert.match(code, /information_schema\.columns/);
  assert.match(code, /pg_catalog\.pg_trigger/);
  assert.match(code, /SET LOCAL statement_timeout/);
  assert.match(code, /PRODUCTION_DATABASE_URL/);
  assert.match(code, /await client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(code, /db:push|migrate\(|--apply|await client\.query\(["'](?:INSERT|UPDATE|DELETE|ALTER|CREATE|TRUNCATE|DROP)\b/i);
});
