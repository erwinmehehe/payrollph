import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../src/db";
import {
  inspectCompensationOutboxSchema,
  validateCompensationOutboxSchema,
  type CompensationOutboxSchemaSnapshot,
} from "../src/lib/compensation-release-schema";

async function capturedCatalog() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const schema = await inspectCompensationOutboxSchema(client, "public");
    await client.query("COMMIT");
    return schema;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function copy(snapshot: CompensationOutboxSchemaSnapshot) {
  return structuredClone(snapshot);
}

test("CI PostgreSQL catalog has the exact durable compensation outbox safety contract", async () => {
  const actual = await capturedCatalog();
  const result = validateCompensationOutboxSchema(actual);
  assert.equal(result.readOnly, true);
  assert.equal(result.schemaCompatible, true, result.issues.join(", "));
  assert.deepEqual(result.issues, []);
});

test("a table name existing without its full schema fails closed", () => {
  const result = validateCompensationOutboxSchema({
    columns: [], constraints: [], indexes: [],
  });
  assert.equal(result.schemaCompatible, false);
  assert.deepEqual(result.issues, ["outbox_table_missing"]);
});

test("missing or incorrect columns and defaults fail schema preflight", async () => {
  const original = await capturedCatalog();
  const missing = copy(original);
  missing.columns = missing.columns.filter((column) => column.column_name !== "compensation_event_id");
  assert.ok(validateCompensationOutboxSchema(missing).issues.includes(
    "column_missing:compensation_event_id",
  ));

  const nullable = copy(original);
  nullable.columns.find((column) => column.column_name === "event_key")!.is_nullable = "YES";
  assert.ok(validateCompensationOutboxSchema(nullable).issues.includes(
    "column_nullability_mismatch:event_key",
  ));

  const wrongLength = copy(original);
  wrongLength.columns.find((column) => column.column_name === "event_key")!.character_maximum_length = 100;
  assert.ok(validateCompensationOutboxSchema(wrongLength).issues.includes(
    "column_length_mismatch:event_key",
  ));

  const badDefault = copy(original);
  badDefault.columns.find((column) => column.column_name === "status")!.column_default = "'dispatched'::text";
  assert.ok(validateCompensationOutboxSchema(badDefault).issues.includes(
    "column_default_mismatch:status",
  ));
});

test("missing dedupe index, nonunique index, and foreign-key cascade fail release gate", async () => {
  const source = await capturedCatalog();
  const missing = copy(source);
  missing.indexes = missing.indexes.filter((index) =>
    index.indexname !== "comp_automation_intent_key_unique");
  assert.ok(validateCompensationOutboxSchema(missing).issues.includes(
    "index_missing_or_unsafe:comp_automation_intent_key_unique",
  ));

  const nonunique = copy(source);
  const unique = nonunique.indexes.find((index) =>
    index.indexname === "comp_automation_intent_key_unique");
  assert.ok(unique);
  unique.indexdef = unique.indexdef.replace("CREATE UNIQUE INDEX", "CREATE INDEX");
  assert.ok(validateCompensationOutboxSchema(nonunique).issues.includes(
    "index_missing_or_unsafe:comp_automation_intent_key_unique",
  ));

  const unsafeFk = copy(source);
  const fk = unsafeFk.constraints.find((row) =>
    row.contype === "f" && row.definition.includes("compensation_event_id"));
  assert.ok(fk);
  fk.definition = fk.definition.replace("ON DELETE CASCADE", "ON DELETE NO ACTION");
  assert.ok(validateCompensationOutboxSchema(unsafeFk).issues.includes(
    "foreign_key_missing_or_unsafe:compensation_event_id",
  ));
});

test("status enum and retry indexes are mandatory even if the outbox exists", async () => {
  const source = await capturedCatalog();
  const missingConstraint = copy(source);
  missingConstraint.constraints = missingConstraint.constraints.filter((row) =>
    row.name !== "comp_automation_intent_status_check");
  assert.ok(validateCompensationOutboxSchema(missingConstraint).issues.includes(
    "status_check_missing_or_incomplete",
  ));

  const invalidRetryIndex = copy(source);
  const idx = invalidRetryIndex.indexes.find((row) =>
    row.indexname === "comp_automation_intent_retry_idx");
  assert.ok(idx);
  idx.indexdef = idx.indexdef.replace("status, next_attempt_at", "status");
  assert.ok(validateCompensationOutboxSchema(invalidRetryIndex).issues.includes(
    "index_missing_or_unsafe:comp_automation_intent_retry_idx",
  ));
});

test("catalog query refuses arbitrary schema identifiers", async () => {
  const client = await pool.connect();
  try {
    await assert.rejects(
      inspectCompensationOutboxSchema(client, "public;drop_schema"),
      /Invalid target PostgreSQL schema/,
    );
    await assert.rejects(
      inspectCompensationOutboxSchema(client, "Public"),
      /Invalid target PostgreSQL schema/,
    );
  } finally {
    client.release();
  }
});
