import { URL } from "node:url";

/**
 * Fail-closed identity checks for operator-run Neon schema audits.
 * The host pins the intended Neon compute endpoint without reading or
 * reporting passwords. Neon branch routing must also be independently
 * verified through the Neon API before the audit is accepted.
 */
export function requireExpectedSchemaAuditTarget(env) {
  const connectionString = env.PRODUCTION_SCHEMA_AUDIT_DATABASE_URL;
  const host = env.PRODUCTION_SCHEMA_AUDIT_EXPECTED_HOST;
  const database = env.PRODUCTION_SCHEMA_AUDIT_EXPECTED_DATABASE_NAME;
  const expectedProjectId = env.PRODUCTION_SCHEMA_AUDIT_EXPECTED_PROJECT_ID;
  const expectedBranchId = env.PRODUCTION_SCHEMA_AUDIT_EXPECTED_BRANCH_ID;
  if (typeof connectionString !== "string" || !connectionString ||
      typeof host !== "string" || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(host) ||
      typeof database !== "string" || !/^[A-Za-z0-9_]{1,63}$/.test(database) ||
      typeof expectedProjectId !== "string" || !/^[a-z0-9-]{1,60}$/.test(expectedProjectId) ||
      typeof expectedBranchId !== "string" || !/^br-[a-z0-9-]{6,60}$/.test(expectedBranchId)) {
    throw new Error("NEON_AUDIT_PINNED_TARGET_REQUIRED");
  }
  let parsed;
  try { parsed = new URL(connectionString); }
  catch { throw new Error("NEON_AUDIT_URL_INVALID"); }
  const pathname = parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : "";
  let candidate;
  try { candidate = decodeURIComponent(pathname); }
  catch { throw new Error("NEON_AUDIT_URL_INVALID"); }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol) ||
      parsed.hostname !== host || candidate !== database ||
      !parsed.username || !parsed.password || parsed.hash ||
      (parsed.port !== "" && parsed.port !== "5432")) {
    throw new Error("NEON_AUDIT_TARGET_MISMATCH");
  }
  return {
    connectionString, expectedDatabaseName: database,
    expectedProjectId, expectedBranchId,
    expectedEndpointId: parsed.hostname.split(".")[0],
  };
}

export const SCHEMA_AUDIT_ROLE_SQL = [
  'SELECT current_database() AS "databaseName",',
  '  current_setting(\'neon.project_id\',true) AS "neonProjectId",',
  '  current_setting(\'neon.branch_id\',true) AS "neonBranchId",',
  '  current_setting(\'neon.endpoint_id\',true) AS "neonEndpointId",',
  '  current_setting(\'transaction_read_only\') = \'on\' AS "readOnly",',
  '  (SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls',
  '     FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS "elevated",',
  '  (pg_catalog.has_schema_privilege(current_user, \'public\', \'CREATE\')',
  '    OR pg_catalog.has_database_privilege(current_user, current_database(), \'CREATE\'))',
  '    AS "canCreate",',
  '  EXISTS (',
  '    SELECT 1 FROM pg_catalog.pg_class c',
  '    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace',
  '    WHERE n.nspname = \'public\' AND c.relkind IN (\'r\',\'p\') AND',
  '      pg_catalog.has_table_privilege(current_user, c.oid,',
  '        \'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER\')',
  '  ) AS "canWriteApplicationTables",',
  '  EXISTS (',
  '    SELECT 1 FROM pg_catalog.pg_class c',
  '    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace',
  '    WHERE n.nspname = \'public\' AND c.relname = ANY(',
  '      ARRAY[\'employees\',\'payroll_entries\',\'payroll_runs\',\'legal_entities\',',
  '        \'employee_pay_profiles\',\'users\'])',
  '      AND pg_catalog.has_any_column_privilege(current_user, c.oid, \'SELECT\')',
  '  ) AS "canReadSensitiveRows"',
].join("\n");

export function assertSchemaAuditRole(row, expected) {
  if (row?.databaseName !== expected?.expectedDatabaseName ||
      row.neonProjectId !== expected?.expectedProjectId ||
      row.neonBranchId !== expected?.expectedBranchId ||
      row.neonEndpointId !== expected?.expectedEndpointId ||
      row.readOnly !== true ||
      row.elevated !== false || row.canCreate !== false ||
      row.canWriteApplicationTables !== false ||
      row.canReadSensitiveRows !== false) {
    throw new Error("NEON_AUDIT_READONLY_ROLE_OR_IDENTITY_REJECTED");
  }
}
