import { operationalSecret } from "@/lib/operational-secret";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { normalizeRuntimeDatabaseIdentity, normalizeRuntimeCompensationTableEvidence } from "@/lib/runtime-database-identity";

export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store", Vary: "x-readiness-token" };

// Private diagnostics only: authorization happens before the DB module is
// imported, and the single SQL statement reads session metadata, never rows.
export async function GET(request: Request) {
  let expected: string | null;
  try {
    expected = operationalSecret("readiness");
  } catch {
    return Response.json({ error: "Readiness verification unavailable." }, {
      status: 503,
      headers: NO_CACHE,
    });
  }
  if (!expected || !constantTimeSecretEqual(request.headers.get("x-readiness-token"), expected)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: NO_CACHE });
  }

  try {
    const { pool } = await import("@/db");
    const result = await pool.query(
      "SELECT pg_catalog.current_database()::text AS \"databaseName\", " +
      "pg_catalog.current_setting('neon.project_id', true)::text AS \"projectId\", " +
      "pg_catalog.current_setting('neon.branch_id', true)::text AS \"branchId\", " +
      "pg_catalog.current_setting('neon.endpoint_id', true)::text AS \"endpointId\", " +
      "current_user::text AS \"roleName\", " +
      "pg_catalog.pg_is_in_recovery() AS \"inRecovery\", " +
      "(SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_class c " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') " +
      "AND c.relname IN ('compensation_bands', 'compensation_cycles', " +
      "'compensation_proposals', 'compensation_components', " +
      "'employee_compensation_components', 'compensation_events')) AS \"compensationTablesPresent\", " +
      "(SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_class c " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') " +
      "AND c.relname IN ('payrollph_release_migration_receipts', " +
      "'payrollph_migration_cutover', 'payrollph_schema_migrations')) AS \"migrationLedgerTablesPresent\""
    );
    const database = normalizeRuntimeDatabaseIdentity(result.rows[0]);
    return Response.json({
      deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      deploymentEnvironment: process.env.VERCEL_ENV ?? null,
      database,
      schemaPresence: normalizeRuntimeCompensationTableEvidence(result.rows[0]),
      evidenceScope: "PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL",
      generatedAt: new Date().toISOString(),
    }, { headers: NO_CACHE });
  } catch {
    // Credentials, connection addresses, raw PostgreSQL errors, stack traces,
    // tenant data and exception SQL must never be returned or logged.
    return Response.json({ error: "Database identity evidence unavailable." }, {
      status: 503,
      headers: NO_CACHE,
    });
  }
}
