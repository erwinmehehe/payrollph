/**
 * Production P0-4 catalog auditor privilege gate.
 * Catalog-only SELECT: never reads rows from employee, payroll, bank or auth tables.
 * A READ ONLY transaction does not make an overprivileged login acceptable.
 * This checks effective privileges, role flags, direct memberships, managed-auth
 * relations, sequences, and reachable SECURITY DEFINER routines.
 * Any unknown/missing boolean is a hard failure. Never log raw DB errors.
 */
import { PINNED_NEON, requireCatalogAuditTransport } from "./historical-dba-evidence.mjs";

/** Validate every audit connection before opening a socket. Never accept startup overrides. */
export function catalogAuditorConnectionOptions(value, expectedDatabase) {
  let target;
  try { target = new URL(value); }
  catch { throw new Error("P0_4_CATALOG_AUDITOR_CONNECTION_NOT_PINNED"); }
  requireCatalogAuditTransport(target);
  if (expectedDatabase !== PINNED_NEON.database ||
      !["postgres:", "postgresql:"].includes(target.protocol) ||
      target.hostname !== PINNED_NEON.host || !["", "5432"].includes(target.port) ||
      target.pathname !== "/" + PINNED_NEON.database ||
      !target.username || !target.password || target.hash) {
    throw new Error("P0_4_CATALOG_AUDITOR_CONNECTION_NOT_PINNED");
  }
  return { connectionString: value, connectionTimeoutMillis: 6000,
    query_timeout: 8000, ssl: { rejectUnauthorized: true } };
}

export const CATALOG_AUDITOR_GUARD_SQL = [
  "WITH self AS (",
  "  SELECT oid,",
  "    (NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole",
  "      AND NOT rolreplication AND NOT rolbypassrls",
  "      AND NOT rolinherit AND rolcanlogin) AS restricted",
  "  FROM pg_catalog.pg_roles",
  "  WHERE rolname = current_user",
  "), relations AS (",
  "  SELECT c.oid, c.relkind, n.nspname, c.relname",
  "  FROM pg_catalog.pg_class c",
  "  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace",
  "  WHERE c.relkind IN ('r','p','v','m','f','S')",
  "    AND n.nspname NOT IN ('pg_catalog','information_schema')",
  "    AND n.nspname !~ '^pg_(toast|temp)'",
  ")",
  "SELECT current_database() = $1::text AS \"databaseMatches\",",
  "  current_user = session_user AS \"sessionMatches\",",
  "  current_setting('transaction_read_only') = 'on' AS \"readOnly\",",
  "  (current_setting('neon.project_id',true) = $2::text",
  "    AND current_setting('neon.branch_id',true) = $3::text",
  "    AND current_setting('neon.endpoint_id',true) = $4::text) AS \"targetMatches\",",
  "  (SELECT restricted FROM self) AS \"restrictedAttributes\",",
  "  NOT EXISTS (",
  "    SELECT 1 FROM pg_catalog.pg_auth_members m",
  "    WHERE m.member = (SELECT oid FROM self)",
  "  ) AS \"withoutMembership\",",
  "  NOT EXISTS (",
  "    SELECT 1 FROM pg_catalog.pg_shdepend d",
  "    WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass",
  "      AND d.refobjid = (SELECT oid FROM self) AND d.deptype = 'o'",
  "  ) AS \"withoutObjectOwnership\",",
  "  NOT pg_catalog.has_database_privilege(",
  "    current_user,current_database(),'CREATE'",
  "  ) AS \"withoutDatabaseCreate\",",
  "  NOT EXISTS (",
  "    SELECT 1 FROM pg_catalog.pg_namespace n",
  "    WHERE n.nspname NOT IN ('pg_catalog','information_schema')",
  "      AND n.nspname !~ '^pg_(toast|temp)'",
  "      AND pg_catalog.has_schema_privilege(current_user,n.oid,'CREATE')",
  "  ) AS \"withoutSchemaCreate\",",
  "  NOT EXISTS (",
  "    SELECT 1 FROM relations c",
  "    WHERE CASE WHEN c.relkind = 'S' THEN",
  "      pg_catalog.has_sequence_privilege(current_user,c.oid,'SELECT,USAGE,UPDATE')",
  "    ELSE",
  "      pg_catalog.has_table_privilege(current_user,c.oid,",
  "        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
  "      OR pg_catalog.has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')",
  "      OR CASE WHEN current_setting('server_version_num')::integer >= 170000 THEN",
  "        pg_catalog.has_table_privilege(current_user,c.oid,'MAINTAIN') ELSE false END",
  "      OR (",
  "        pg_catalog.has_any_column_privilege(current_user,c.oid,'SELECT')",
  "        AND NOT (",
  "          c.nspname = 'public' AND c.relkind IN ('r','p')",
  "          AND c.relname IN (",
  "            'payrollph_release_migration_receipts',",
  "            'payrollph_migration_cutover',",
  "            'payrollph_schema_migrations'",
  "          )",
  "        )",
  "      )",
  "    END",
  "  ) AS \"withoutUnexpectedRelationAccess\",",
  "  NOT EXISTS (",
  "    SELECT 1 FROM pg_catalog.pg_proc p",
  "    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace",
  "    WHERE p.prosecdef",
  "      AND n.nspname NOT IN ('pg_catalog','information_schema')",
  "      AND n.nspname !~ '^pg_(toast|temp)'",
  "      AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')",
  "  ) AS \"withoutSecurityDefinerExecution\",",
  "  (",
  "    SELECT count(*)::integer FROM relations c",
  "    WHERE c.nspname = 'public' AND c.relkind IN ('r','p')",
  "      AND c.relname IN (",
  "        'payrollph_release_migration_receipts',",
  "        'payrollph_migration_cutover',",
  "        'payrollph_schema_migrations'",
  "      )",
  "      AND pg_catalog.has_table_privilege(current_user,c.oid,'SELECT')",
  "  ) = 3 AS \"journalsReadable\""
].join("\n");

const BASE_REQUIREMENTS = Object.freeze([
  "databaseMatches", "sessionMatches", "readOnly", "targetMatches", "restrictedAttributes",
  "withoutMembership", "withoutDatabaseCreate", "withoutSchemaCreate",
  "withoutObjectOwnership",
  "withoutUnexpectedRelationAccess", "withoutSecurityDefinerExecution",
]);

export function verifyCatalogAuditorFlags(row, { requireJournals = false } = {}) {
  if (typeof requireJournals !== "boolean" || !row || typeof row !== "object" ||
      BASE_REQUIREMENTS.some(key => row[key] !== true) ||
      (requireJournals && row.journalsReadable !== true)) {
    throw new Error("P0_4_CATALOG_AUDITOR_NOT_LEAST_PRIVILEGED");
  }
  return Object.freeze({ catalogOnly: true, payrollRowsQueried: false,
    migrationReceiptsVerified: false, productionReleaseApproved: false });
}

export async function assertCatalogAuditorPrivilegeBoundary(
  client, { expectedDatabase, requireJournals = false } = {},
) {
  if (!client || typeof client.query !== "function" ||
      expectedDatabase !== PINNED_NEON.database ||
      typeof requireJournals !== "boolean") {
    throw new Error("P0_4_CATALOG_AUDITOR_TARGET_NOT_PINNED");
  }
  const answer = await client.query(CATALOG_AUDITOR_GUARD_SQL, [
    expectedDatabase, PINNED_NEON.projectId, PINNED_NEON.branchId,
    PINNED_NEON.endpointId,
  ]);
  if (!Array.isArray(answer?.rows) || answer.rows.length !== 1) {
    throw new Error("P0_4_CATALOG_AUDITOR_IDENTITY_UNVERIFIED");
  }
  return verifyCatalogAuditorFlags(answer.rows[0], { requireJournals });
}
