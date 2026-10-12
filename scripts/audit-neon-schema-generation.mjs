#!/usr/bin/env node
/**
 * Operator-invoked, read-only schema generation audit.
 * Use a separate SELECT-only database principal. This script never migrates,
 * mutates tables, reads sensitive rows, or authorizes a release.
 */
import pg from "pg";
import {
  requireExpectedSchemaAuditTarget, SCHEMA_AUDIT_ROLE_SQL, assertSchemaAuditRole,
} from "./lib/neon-schema-audit-identity.mjs";
import { pathToFileURL } from "node:url";
import {
  DATABASE_GENERATION_FINGERPRINT_SQL, assessDatabaseGeneration,
} from "./lib/database-generation-fingerprint.mjs";
import {
  CANONICAL_MIGRATION_BASE_TABLES_SQL,
  assessCanonicalMigrationTables,
} from "./lib/canonical-migration-base-tables.mjs";
import {
  FOUNDATION_OBJECTS_SQL, assessFoundationObjects,
} from "./lib/foundation-migration-objects.mjs";

export async function audit(env = process.env) {
  const { connectionString, expectedDatabaseName } = requireExpectedSchemaAuditTarget(env);
  const client = new pg.Client({
    connectionString, connectionTimeoutMillis: 5000, query_timeout: 10000,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const roleIdentity = await client.query(SCHEMA_AUDIT_ROLE_SQL);
    assertSchemaAuditRole(roleIdentity.rows[0], expectedDatabaseName);
    const result = await client.query(DATABASE_GENERATION_FINGERPRINT_SQL);
    const row = result.rows[0];
    const assessment = assessDatabaseGeneration(row);
    const targets = await client.query(CANONICAL_MIGRATION_BASE_TABLES_SQL);
    const canonicalTrain = assessCanonicalMigrationTables(targets.rows);
    const foundations = assessFoundationObjects((await client.query(FOUNDATION_OBJECTS_SQL)).rows);
    return {
      databaseName: row?.databaseName ?? null,
      expectedDatabaseNameMatched: row?.databaseName === expectedDatabaseName,
      serverVersionNum: row?.serverVersionNum ?? null,
      publicTableCount: row?.publicTableCount ?? null,
      generation: assessment.generation,
      canonicalTrain,
      foundations,
      missingTrainPrerequisites: assessment.missingTrainPrerequisites ?? [],
      eligibleForMigrationReview: assessment.eligibleForMigrationReview && foundations.allExpectedObjectsPresent,
      productionMigrationApproved: false,
      reason: !foundations.allExpectedObjectsPresent ? "FOUNDATION_OBJECTS_MISSING" : assessment.reason,
      generationReason: assessment.reason,
    };
  } finally {
    if (connected) {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
  }
}

export async function main(env = process.env) {
  try {
    const result = await audit(env);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.eligibleForMigrationReview) process.exitCode = 2;
    return result;
  } catch {
    // Do not echo connection strings or driver exceptions that may include secrets.
    process.stderr.write("READ_ONLY_DATABASE_GENERATION_AUDIT_FAILED\n");
    process.exitCode = 2;
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
