import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");

test("canonical Drizzle declarations own formerly auto-created compliance tables", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  for (const table of [
    "contractor_payments",
    "supplementary_earnings",
    "shift_definitions",
    "schedule_patterns",
    "schedule_pattern_days",
    "schedule_pattern_segments",
    "employee_schedule_assignments",
    "schedule_overrides",
    "legal_entities",
    "historical_payroll_entries",
  ]) {
    assert.match(schema, new RegExp('pgTable\\(\\s*"' + table + '"'),
      "canonical schema is missing " + table);
  }
  assert.ok(source.includes("await verifyCoreSchemaReadOnly("),
    "request paths must verify the canonical catalog rather than auto-create tables");
});

test("core request compatibility never backfills bank or government identifiers", () => {
  assert.ok(source.includes("export async function bankDataEncryptionReady()"));
  assert.ok(source.includes("await ensureCoreCompatibilitySchema()"));
  assert.ok(source.includes("bank_account NOT LIKE 'enc:v1:%'"));
  assert.doesNotMatch(source, /backfillBankDataEncryption|backfillGovernmentIdEncryption/);
  assert.doesNotMatch(source, /encryptBankAccount\(|encryptGovernmentId\(|decryptGovernmentId\(/);
  assert.doesNotMatch(source, /\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
});

test("core request compatibility never locks or modifies database structures", () => {
  assert.ok(source.includes("coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE)"));
  assert.ok(source.includes("await verifyCoreSchemaReadOnly("));
  assert.doesNotMatch(source, /pg_advisory_xact_lock/);
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INDEX|SCHEMA|VIEW|TRIGGER)\b/i);
});
