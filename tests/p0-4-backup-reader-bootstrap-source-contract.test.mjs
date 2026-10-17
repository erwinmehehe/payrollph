import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../scripts/sql/p0-4-proposed-backup-reader-bootstrap.sql", import.meta.url),
  "utf8",
);

test("P0-4 operator-only bootstrap fails closed on exact Neon target", () => {
  const identityChecks = [
    "current_database() <> 'neondb'",
    "current_setting('neon.project_id', true) IS DISTINCT FROM 'calm-wave-70219564'",
    "current_setting('neon.branch_id', true) IS DISTINCT FROM 'br-lucky-sound-b79i56jw'",
    "current_setting('neon.endpoint_id', true) IS DISTINCT FROM 'ep-cool-hat-b7e7gpoo'",
    "P0_4_BACKUP_READER_WRONG_NEON_SOURCE",
    "P0_4_BACKUP_READER_ALREADY_EXISTS_REVIEW_MANUALLY",
    "P0_4_BACKUP_READER_REQUIRED_SCHEMAS_MISSING",
    "P0_4_BACKUP_READER_RLS_REVIEW_REQUIRED",
  ];
  for (const required of identityChecks) assert.ok(sql.includes(required), required);
  assert.ok(sql.indexOf("P0_4_BACKUP_READER_WRONG_NEON_SOURCE") <
    sql.indexOf("CREATE ROLE payrollph_backup_reader"), "identity check must precede DDL");
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/, "role changes must be a transaction");
});

test("P0-4 backup reader is non-login, non-elevated and requires private activation", () => {
  const create = sql.match(/CREATE ROLE payrollph_backup_reader\s+WITH\s+([\s\S]*?);/);
  assert.ok(create, "must explicitly create the intended role");
  for (const property of [
    "NOLOGIN", "NOSUPERUSER", "NOCREATEDB", "NOCREATEROLE",
    "NOINHERIT", "NOREPLICATION", "NOBYPASSRLS", "CONNECTION LIMIT 1",
  ]) assert.ok(create[1].includes(property), property);
  assert.doesNotMatch(create[0], /\bPASSWORD\b|\bLOGIN\b(?!\S)/);
  assert.doesNotMatch(sql, /^\s*ALTER ROLE payrollph_backup_reader\s+LOGIN\b/gim);
  assert.match(sql, /ALTER ROLE payrollph_backup_reader SET default_transaction_read_only = on;/);
});

test("P0-4 backup reader has only SELECT data grants including sequences", () => {
  const grants = sql.split("\n").filter(line => /^GRANT /i.test(line.trim()));
  assert.deepEqual(grants, [
    "GRANT CONNECT ON DATABASE neondb TO payrollph_backup_reader;",
    "GRANT USAGE ON SCHEMA public, neon_auth TO payrollph_backup_reader;",
    "GRANT SELECT ON ALL TABLES IN SCHEMA public, neon_auth TO payrollph_backup_reader;",
    "GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, neon_auth TO payrollph_backup_reader;",
  ]);
  assert.doesNotMatch(sql, /^\s*GRANT\s+(?:ALL|UPDATE|DELETE|INSERT|TRUNCATE|USAGE\s+ON\s+ALL\s+SEQUENCES)\b/gim);
  assert.doesNotMatch(sql, /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\s+/gim);
  assert.doesNotMatch(sql, /\bALTER DEFAULT PRIVILEGES\b/i);
});

test("P0-4 postflight rejects ownership, role membership and mutation rights", () => {
  for (const guard of [
    "P0_4_BACKUP_READER_FLAGS_UNSAFE",
    "pg_catalog.pg_auth_members",
    "has_database_privilege(reader_id, current_database(), 'CREATE')",
    "P0_4_BACKUP_READER_SCHEMA_PRIVILEGES_INVALID",
    "P0_4_BACKUP_READER_TABLE_PRIVILEGES_INVALID",
    "P0_4_BACKUP_READER_SEQUENCE_PRIVILEGES_INVALID",
    "has_sequence_privilege(reader_id, s.oid, 'SELECT')",
    "has_sequence_privilege(reader_id, s.oid, 'USAGE,UPDATE')",
  ]) assert.ok(sql.includes(guard), guard);
  assert.match(sql, /WITH sequences AS MATERIALIZED/);
});

test("bootstrap remains source-only, not an automated migration or data export", () => {
  assert.match(sql, /OPERATOR-ONLY PROPOSAL/);
  assert.match(sql, /THIS FILE IS NOT A MIGRATION/);
  assert.doesNotMatch(sql, /\bpg_dump\s+--(?:file|format)/);
  assert.doesNotMatch(sql, /^\s*COPY\b/gim);
});
