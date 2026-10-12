import assert from "node:assert/strict";
import test from "node:test";
import {
  requireExpectedSchemaAuditTarget, assertSchemaAuditRole, SCHEMA_AUDIT_ROLE_SQL,
} from "../scripts/lib/neon-schema-audit-identity.mjs";

const expectedHost = "ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech";
const valid = {
  PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: "postgresql://readonly:secret@" + expectedHost + "/neondb?sslmode=require",
  PRODUCTION_SCHEMA_AUDIT_EXPECTED_HOST: expectedHost,
  PRODUCTION_SCHEMA_AUDIT_EXPECTED_DATABASE_NAME: "neondb",
};
const goodRole = {
  databaseName: "neondb", readOnly: true, elevated: false, canCreate: false,
  canWriteApplicationTables: false, canReadSensitiveRows: false,
};

test("requires explicit Neon endpoint and database pins without logging credentials", () => {
  const r = requireExpectedSchemaAuditTarget(valid);
  assert.equal(r.expectedDatabaseName, "neondb");
  assert.ok(r.connectionString.startsWith("postgresql://"));
  assert.throws(() => requireExpectedSchemaAuditTarget({ ...valid, PRODUCTION_SCHEMA_AUDIT_EXPECTED_HOST: "" }), /PINNED_TARGET_REQUIRED/);
  assert.throws(() => requireExpectedSchemaAuditTarget({ ...valid, PRODUCTION_SCHEMA_AUDIT_EXPECTED_DATABASE_NAME: "" }), /PINNED_TARGET_REQUIRED/);
  assert.throws(() => requireExpectedSchemaAuditTarget({ ...valid, PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: "not-a-url" }), /URL_INVALID/);
});
test("refuses a snapshot-branch hostname, another database, or non-Neon host", () => {
  for (const input of [
    { ...valid, PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: "postgresql://u:p@ep-dry-dew-b7liu3o6.c-13.us-east-1.aws.neon.tech/neondb" },
    { ...valid, PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: "postgresql://u:p@" + expectedHost + "/otherdb" },
    { ...valid, PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: "postgresql://u:p@127.0.0.1/neondb" },
    { ...valid, PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: "https://u:p@" + expectedHost + "/neondb" },
    { ...valid, PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: "postgresql://u:p@" + expectedHost + "/neondb#unexpected" },
  ]) assert.throws(() => requireExpectedSchemaAuditTarget(input), /TARGET_MISMATCH/);
});
test("role preflight requires read-only transaction and non-privileged SELECT-only role", () => {
  assert.doesNotThrow(() => assertSchemaAuditRole(goodRole, "neondb"));
  for (const bad of [
    { ...goodRole, databaseName: "different" },
    { ...goodRole, readOnly: false },
    { ...goodRole, elevated: true },
    { ...goodRole, canCreate: true },
    { ...goodRole, canWriteApplicationTables: true },
    { ...goodRole, canReadSensitiveRows: true },
    {}, null,
  ]) assert.throws(() => assertSchemaAuditRole(bad, "neondb"), /READONLY_ROLE_OR_IDENTITY_REJECTED/);
});
test("role preflight uses catalogs and privilege checks without reading tenant rows", () => {
  assert.match(SCHEMA_AUDIT_ROLE_SQL, /pg_catalog\.pg_roles/);
  assert.match(SCHEMA_AUDIT_ROLE_SQL, /has_any_column_privilege/);
  assert.doesNotMatch(SCHEMA_AUDIT_ROLE_SQL, /SELECT \* FROM public\./);
});
