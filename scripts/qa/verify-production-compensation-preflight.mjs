/**
 * Private GitHub Actions-only, read-only production compensation preflight.
 * Parses a local ephemeral JSON file returned by the token-gated runtime probe.
 * Never logs the response, DB role, full URL, session token, or table data.
 * Table presence is NOT permission to execute DDL or certify the privacy probe.
 */
import { readFileSync } from "node:fs";

function fail(reason) { throw new Error("PRODUCTION_COMPENSATION_PREFLIGHT_" + reason); }

export function verifyProductionCompensationPreflight(payload, expected) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("INVALID_PRIVATE_RESPONSE");
  const database = payload.database;
  const schema = payload.schemaPresence;
  if (!database || typeof database !== "object" ||
      !schema || typeof schema !== "object" ||
      payload.evidenceScope !== "PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL" ||
      payload.deploymentSha !== expected.sha ||
      payload.deploymentEnvironment !== "production") fail("WRONG_DEPLOYMENT_OR_RESPONSE");
  // Report only the failed predicate category, never the actual/private
  // project, branch, endpoint, database, role or readiness JSON value.
  // These diagnostics do not waive ANY identity or catalog prerequisite.
  if (!/^[0-9a-f]{40}$/.test(String(expected.sha ?? ""))) fail("INVALID_EXPECTED_SHA");
  if (database.projectId !== expected.projectId) fail("WRONG_PROJECT");
  if (database.branchId !== expected.branchId) fail("WRONG_BRANCH");
  if (database.endpointId !== expected.endpointId) fail("WRONG_ENDPOINT");
  if (database.databaseName !== expected.databaseName) fail("WRONG_DATABASE_NAME");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(String(database.roleName ?? ""))) fail("INVALID_ROLE_NAME");
  if (database.inRecovery !== false) fail("RECOVERY_TARGET");
  if (schema.evidenceScope !== "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL" ||
      schema.compensationTablesExpected !== 6 ||
      schema.migrationLedgerTablesExpected !== 3 ||
      !Number.isSafeInteger(schema.compensationTablesPresent) ||
      !Number.isSafeInteger(schema.migrationLedgerTablesPresent) ||
      schema.compensationTablesPresent < 0 || schema.compensationTablesPresent > 6 ||
      schema.migrationLedgerTablesPresent < 0 || schema.migrationLedgerTablesPresent > 3) {
    fail("INVALID_SCHEMA_EVIDENCE");
  }
  if (schema.compensationTablesPresent !== 6) fail("MISSING_COMPENSATION_TABLES_USE_DBA_MIGRATION");
  if (schema.migrationLedgerTablesPresent !== 3) fail("MISSING_MIGRATION_LEDGER_STOP");
  // No per-table DDL parity, historical execution receipt, backup/restore,
  // independent DBA authorization or payroll release is implied by this check.
  return true;
}

if (process.argv[1]?.endsWith("/verify-production-compensation-preflight.mjs")) {
  try {
    const filePath = process.argv[2];
    if (!filePath || process.argv.length !== 3) fail("PRIVATE_FILE_REQUIRED");
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    const env = process.env;
    verifyProductionCompensationPreflight(payload, {
      sha: env.EXPECTED_COMMIT_SHA,
      projectId: env.EXPECTED_NEON_PROJECT_ID,
      branchId: env.EXPECTED_NEON_BRANCH_ID,
      endpointId: env.EXPECTED_NEON_ENDPOINT_ID,
      databaseName: env.EXPECTED_NEON_DATABASE_NAME,
    });
    console.log("PASS: exact deployed source and Neon target, required catalog tables present (not migration approval).");
  } catch (error) {
    // Do not print untrusted payloads or fetched metadata to CI logs.
    console.error(error instanceof Error && /^PRODUCTION_COMPENSATION_PREFLIGHT_[A-Z_]+$/.test(error.message)
      ? error.message
      : "PRODUCTION_COMPENSATION_PREFLIGHT_INVALID_PRIVATE_EVIDENCE");
    process.exitCode = 1;
  }
}
