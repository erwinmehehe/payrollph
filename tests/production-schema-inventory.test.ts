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
  validatedReleaseIndexes,
  type ReleaseIndexMetadata,
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
  assert.match(code, /pg_catalog\.pg_attribute/);
  assert.match(code, /pg_catalog\.pg_trigger/);
  assert.match(readFileSync("src/lib/production-schema-inventory.ts", "utf8"), /pg_catalog\.pg_index/);
  assert.match(code, /pg_catalog\.has_table_privilege/);
  assert.match(code, /canReadPayrollRows/);
  assert.match(code, /EXPECTED_PRODUCTION_DATABASE_NAME/);
  assert.match(code, /validatedReleaseIndexes\(indexes\.rows\)/);
  assert.match(code, /t\.tgtype & 27/);
  assert.doesNotMatch(code, /information_schema\.columns/);
  assert.match(code, /SET LOCAL statement_timeout/);
  assert.match(code, /PRODUCTION_DATABASE_URL/);
  assert.match(code, /await client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(code, /db:push|migrate\(|--apply|await client\.query\(["'](?:INSERT|UPDATE|DELETE|ALTER|CREATE|TRUNCATE|DROP)\b/i);
});


function validIndexRows(): ReleaseIndexMetadata[] {
  return [
    {
      name: "saas_billing_one_open_checkout", tableName: "saas_billing_checkouts",
      isUnique: true, isValid: true, isReady: true, keys: ["organization_id"],
      predicate: "status IN ('creating', 'awaiting_payment', 'review_required')",
    },
    {
      name: "audit_events_chain_seq_unique", tableName: "audit_events",
      isUnique: true, isValid: true, isReady: true,
      keys: ["COALESCE(organization_id, 0)", "chain_seq"],
      predicate: "(chain_seq IS NOT NULL)",
    },
    {
      name: "provider_events_provider_event_id_unique", tableName: "provider_events",
      isUnique: true, isValid: true, isReady: true, keys: ["provider", "event_id"], predicate: null,
    },
    {
      name: "comp_automation_intent_key_unique", tableName: "compensation_automation_intents",
      isUnique: true, isValid: true, isReady: true,
      keys: ["organization_id", "\"trigger\"", "event_key"], predicate: null,
    },
  ];
}

test("expected live PostgreSQL index signatures pass a catalog-only read", () => {
  assert.deepEqual(validatedReleaseIndexes(validIndexRows()), [...requiredReleaseIndexes]);
});

test("wrong-table and nonunique name-matched indexes do not bypass release canary", () => {
  const wrongTable = validIndexRows();
  wrongTable[2] = { ...wrongTable[2], tableName: "payroll_runs" };
  assert.ok(!validatedReleaseIndexes(wrongTable).includes("provider_events_provider_event_id_unique"));

  const nonUnique = validIndexRows();
  nonUnique[2] = { ...nonUnique[2], isUnique: false };
  assert.ok(!validatedReleaseIndexes(nonUnique).includes("provider_events_provider_event_id_unique"));
});

test("invalid, not-ready and wrong-key indexes do not bypass release canary", () => {
  for (const modification of [
    { isValid: false },
    { isReady: false },
    { keys: ["provider", "payroll_run_id"] },
    { keys: ["provider", "event_id", "organization_id"] },
  ]) {
    const rows = validIndexRows();
    rows[2] = { ...rows[2], ...modification };
    assert.ok(!validatedReleaseIndexes(rows).includes("provider_events_provider_event_id_unique"));
  }
});

test("partial unique indexes require expected predicate and keys", () => {
  const wrongPredicate = validIndexRows();
  wrongPredicate[0] = { ...wrongPredicate[0], predicate: "status IN ('creating')" };
  assert.ok(!validatedReleaseIndexes(wrongPredicate).includes("saas_billing_one_open_checkout"));

  const noPredicate = validIndexRows();
  noPredicate[1] = { ...noPredicate[1], predicate: null };
  assert.ok(!validatedReleaseIndexes(noPredicate).includes("audit_events_chain_seq_unique"));

  const nonpartial = validIndexRows();
  nonpartial[3] = { ...nonpartial[3], predicate: "status = 'pending'" };
  assert.ok(!validatedReleaseIndexes(nonpartial).includes("comp_automation_intent_key_unique"));
});

test("operator workflow cannot run with PR branch, unknown target or stale reviewed SHA", () => {
  const workflow = readFileSync(".github/workflows/production-schema-inventory.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /\$REVIEWED_SHA" != "\$GITHUB_SHA"/);
  assert.match(workflow, /expected_database_name:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /db:push|migrate|drizzle-kit push|npm run db:push/i);
});
