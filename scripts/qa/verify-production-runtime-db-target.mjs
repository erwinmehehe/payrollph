#!/usr/bin/env node
/**
 * #1198: attest the deployed app's DB session through its private metadata-only
 * endpoint. This code never connects directly to PostgreSQL or prints secrets.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_PROBE_URL =
  "https://erwinmehehe-payrollph.vercel.app/api/readiness/database-target";

const ERROR_CODE = "RUNTIME_DB_TARGET_ATTESTATION_BLOCKED";
function refuse() { throw new Error(ERROR_CODE); }

function identifier(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) refuse();
  return value;
}

export function validateExpectations(value) {
  if (!value || typeof value !== "object") refuse();
  return {
    commitSha: identifier(value.commitSha, /^[0-9a-f]{40}$/),
    databaseName: identifier(value.databaseName, /^[A-Za-z0-9_]{1,63}$/),
    projectId: identifier(value.projectId, /^[a-z0-9-]{1,60}$/),
    branchId: identifier(value.branchId, /^br-[a-z0-9-]{4,58}$/),
    endpointId: identifier(value.endpointId, /^ep-[a-z0-9-]{4,58}$/),
    roleName: identifier(value.roleName, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
  };
}

function integer(value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) refuse();
  return value;
}

export function compareRuntimeEvidence(payload, expectations) {
  const expected = validateExpectations(expectations);
  if (!payload || typeof payload !== "object" ||
      payload.evidenceScope !== "PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL" ||
      payload.deploymentSha !== expected.commitSha ||
      payload.deploymentEnvironment !== "production") refuse();
  const db = payload.database;
  if (!db || typeof db !== "object" ||
      db.databaseName !== expected.databaseName ||
      db.projectId !== expected.projectId ||
      db.branchId !== expected.branchId ||
      db.endpointId !== expected.endpointId ||
      db.roleName !== expected.roleName ||
      db.inRecovery !== false) refuse();
  const schema = payload.schemaPresence;
  if (!schema || typeof schema !== "object" ||
      schema.evidenceScope !== "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL" ||
      schema.compensationTablesExpected !== 6 ||
      schema.migrationLedgerTablesExpected !== 3) refuse();
  return {
    kind: "production-runtime-db-session-attestation",
    checkedCommit: expected.commitSha,
    deploymentShaMatches: true,
    environmentProduction: true,
    neonSessionIdentityMatchesIndependentConfiguration: true,
    compensationTablesPresent: integer(schema.compensationTablesPresent, 6),
    compensationTablesExpected: 6,
    migrationLedgerTablesPresent: integer(schema.migrationLedgerTablesPresent, 3),
    migrationLedgerTablesExpected: 3,
    productionMigrationApproved: false,
    historicalMigrationReceiptsProven: false,
    humanDbaReviewComplete: false,
    databaseRowsRead: false,
    databaseMutationsPerformed: false,
  };
}

export async function attestRuntimeTarget({ token, expectations, fetchImpl = fetch }) {
  validateExpectations(expectations);
  if (typeof token !== "string" || token.length < 32 ||
      token.length > 4096 || /[\r\n]/.test(token)) refuse();
  let response;
  try {
    response = await fetchImpl(RUNTIME_PROBE_URL, {
      method: "GET", redirect: "error", cache: "no-store",
      headers: { "x-readiness-token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
  } catch { refuse(); }
  if (response?.status !== 200 ||
      !response.headers?.get("content-type")?.toLowerCase().includes("application/json")) refuse();
  const len = response.headers.get("content-length");
  if (len && (!/^[0-9]+$/.test(len) || Number(len) > 8192)) refuse();
  let payload;
  try {
    const raw = await response.text();
    if (raw.length > 8192) refuse();
    payload = JSON.parse(raw);
  } catch { refuse(); }
  return compareRuntimeEvidence(payload, expectations);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.CI !== "true" ||
        process.env.GITHUB_ACTIONS !== "true" ||
        process.env.GITHUB_REF !== "refs/heads/main") refuse();
    const result = await attestRuntimeTarget({
      token: process.env.PRODUCTION_READINESS_TOKEN,
      expectations: {
        commitSha: process.env.GITHUB_SHA,
        databaseName: process.env.EXPECTED_PRODUCTION_DATABASE_NAME,
        projectId: process.env.EXPECTED_PRODUCTION_NEON_PROJECT_ID,
        branchId: process.env.EXPECTED_PRODUCTION_NEON_BRANCH_ID,
        endpointId: process.env.EXPECTED_PRODUCTION_NEON_ENDPOINT_ID,
        roleName: process.env.EXPECTED_PRODUCTION_RUNTIME_DB_ROLE,
      },
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch {
    process.stderr.write(ERROR_CODE + "; no production migration authorized.\n");
    process.exitCode = 1;
  }
}
