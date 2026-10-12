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
  PRODUCTION_SCHEMA_AUDIT_EXPECTED_PROJECT_ID: "calm-wave-70219564",
  PRODUCTION_SCHEMA_AUDIT_EXPECTED_BRANCH_ID: "br-lucky-sound-b79i56jw",
};
const goodRole = {
  databaseName: "neondb",
  neonProjectId: "calm-wave-70219564",
  neonBranchId: "br-lucky-sound-b79i56jw",
  neonEndpointId: "ep-cool-hat-b7e7gpoo",
  readOnly: true, elevated: false, canCreate: false,
  canWriteApplicationTables: false, canReadSensitiveRows: false,
};

const expected = {
  expectedDatabaseName: "neondb",
  expectedProjectId: "calm-wave-70219564",
  expectedBranchId: "br-lucky-sound-b79i56jw",
  expectedEndpointId: "ep-cool-hat-b7e7gpoo",
};

test("catalog audit refuses connection overrides before constructing a client", () => {
  const prefix = "postgresql://readonly:synthetic@" + expectedHost + "/neondb";
  for (const query of ["host=wrong.invalid", "port=5433", "user=owner", "password=wrong",
    "options=-c%20neon.branch_id%3Dbr-forged", "sslkey=/tmp/private.key",
    "sslmode=disable", "sslmode=require&sslmode=require"]) {
    assert.throws(() => requireExpectedSchemaAuditTarget({ ...valid,
      PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: prefix + "?" + query,
    }), /CONNECTION_OPTIONS_REJECTED/);
  }
  assert.doesNotThrow(() => requireExpectedSchemaAuditTarget({ ...valid,
    PRODUCTION_SCHEMA_AUDIT_DATABASE_URL: prefix + "?sslmode=verify-full&channel_binding=require",
  }));
});

test("requires explicit Neon endpoint and database pins without logging credentials", () => {
  const r = requireExpectedSchemaAuditTarget(valid);
  assert.equal(r.expectedDatabaseName, "neondb");
  assert.equal(r.expectedProjectId, expected.expectedProjectId);
  assert.equal(r.expectedBranchId, expected.expectedBranchId);
  assert.equal(r.expectedEndpointId, expected.expectedEndpointId);
  assert.ok(r.connectionString.startsWith("postgresql://"));
  assert.throws(() => requireExpectedSchemaAuditTarget({ ...valid, PRODUCTION_SCHEMA_AUDIT_EXPECTED_HOST: "" }), /PINNED_TARGET_REQUIRED/);
  assert.throws(() => requireExpectedSchemaAuditTarget({ ...valid, PRODUCTION_SCHEMA_AUDIT_EXPECTED_DATABASE_NAME: "" }), /PINNED_TARGET_REQUIRED/);
  assert.throws(() => requireExpectedSchemaAuditTarget({ ...valid, PRODUCTION_SCHEMA_AUDIT_EXPECTED_PROJECT_ID: "" }), /PINNED_TARGET_REQUIRED/);
  assert.throws(() => requireExpectedSchemaAuditTarget({ ...valid, PRODUCTION_SCHEMA_AUDIT_EXPECTED_BRANCH_ID: "" }), /PINNED_TARGET_REQUIRED/);
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
  assert.doesNotThrow(() => assertSchemaAuditRole(goodRole, expected));
  for (const bad of [
    { ...goodRole, databaseName: "different" },
    { ...goodRole, neonProjectId: "other-project" },
    { ...goodRole, neonBranchId: "br-aged-mouse-b7tipaw5" },
    { ...goodRole, neonEndpointId: "ep-dry-dew-b7liu3o6" },
    { ...goodRole, readOnly: false },
    { ...goodRole, elevated: true },
    { ...goodRole, canCreate: true },
    { ...goodRole, canWriteApplicationTables: true },
    { ...goodRole, canReadSensitiveRows: true },
    {}, null,
  ]) assert.throws(() => assertSchemaAuditRole(bad, expected), /READONLY_ROLE_OR_IDENTITY_REJECTED/);
});
test("role preflight uses catalogs and privilege checks without reading tenant rows", () => {
  assert.match(SCHEMA_AUDIT_ROLE_SQL, /pg_catalog\.pg_roles/);
  assert.match(SCHEMA_AUDIT_ROLE_SQL, /neon\.branch_id/);
  assert.match(SCHEMA_AUDIT_ROLE_SQL, /neon\.project_id/);
  assert.match(SCHEMA_AUDIT_ROLE_SQL, /neon\.endpoint_id/);
  assert.match(SCHEMA_AUDIT_ROLE_SQL, /has_any_column_privilege/);
  assert.doesNotMatch(SCHEMA_AUDIT_ROLE_SQL, /SELECT \* FROM public\./);
});
