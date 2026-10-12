/**
 * Read-only foundation-object inventory for the partial SQL adoption on
 * the correct Neon PayrollPH branch. Presence is NOT an applied-SQL receipt,
 * a checksum, complete column/constraint equivalence or release approval.
 * The legacy 0022 file is deliberately identified by its FULL name because
 * several retained historical files share numeric prefixes.
 */
export const FOUNDATION_OBJECTS = Object.freeze([
  { migration: "0022_job_architecture_positions.sql", kind: "table", objectName: "job_profiles" },
  { migration: "0022_job_architecture_positions.sql", kind: "table", objectName: "workforce_plans" },
  { migration: "0022_job_architecture_positions.sql", kind: "table", objectName: "positions" },
  { migration: "0022_job_architecture_positions.sql", kind: "table", objectName: "position_assignments" },
  { migration: "0109_tamper_evident_audit_chain.sql", kind: "table", objectName: "audit_chain_heads" },
  { migration: "0109_tamper_evident_audit_chain.sql", kind: "column", objectName: "audit_events.chain_seq" },
  { migration: "0109_tamper_evident_audit_chain.sql", kind: "column", objectName: "audit_events.prev_hash" },
  { migration: "0109_tamper_evident_audit_chain.sql", kind: "column", objectName: "audit_events.row_hash" },
  { migration: "0109_tamper_evident_audit_chain.sql", kind: "index", objectName: "audit_events_chain_seq_unique" },
  { migration: "0109_tamper_evident_audit_chain.sql", kind: "function_integer", objectName: "seal_audit_events" },
  { migration: "0109_tamper_evident_audit_chain.sql", kind: "function_zero", objectName: "audit_events_protect" },
  { migration: "0109_tamper_evident_audit_chain.sql", kind: "trigger", objectName: "audit_events_protect_mutation" },
  { migration: "0110_provider_events_inbox.sql", kind: "table", objectName: "provider_events" },
  { migration: "0110_provider_events_inbox.sql", kind: "index", objectName: "provider_events_provider_event_id_unique" },
  { migration: "0111_wfm_geofenced_web_bundy.sql", kind: "table", objectName: "worksite_geofence_boundaries" },
  { migration: "0112_wfm_operational_demand_observations.sql", kind: "table", objectName: "workforce_demand_import_batches" },
  { migration: "0112_wfm_operational_demand_observations.sql", kind: "table", objectName: "workforce_demand_observation_revisions" },
  { migration: "0113_wfm_issued_demand_forecasts.sql", kind: "table", objectName: "workforce_demand_forecast_issues" },
  { migration: "0113_wfm_issued_demand_forecasts.sql", kind: "table", objectName: "workforce_demand_forecast_scores" },
  { migration: "0114_wfm_demand_staffing_policies.sql", kind: "table", objectName: "workforce_demand_staffing_policies" },
  { migration: "0114_wfm_demand_staffing_policies.sql", kind: "table", objectName: "workforce_demand_staffing_policy_events" },
]);

// Every identifier below is a committed source literal. No user input enters SQL.
export const FOUNDATION_OBJECTS_SQL = [
  "WITH expected(migration, kind, object_name) AS (VALUES",
  FOUNDATION_OBJECTS.map((item) =>
    "  ('" + item.migration + "','" + item.kind + "','" + item.objectName + "')"
  ).join(",\n"),
  ")",
  'SELECT e.migration AS "migration", e.kind AS "kind",',
  '  e.object_name AS "objectName",',
  "  CASE",
  "    WHEN e.kind IN ('table','index') THEN",
  "      EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
  "        WHERE n.nspname='public' AND c.relname=e.object_name AND",
  "          ((e.kind='table' AND c.relkind IN ('r','p')) OR (e.kind='index' AND c.relkind IN ('i','I'))))",
  "    WHEN e.kind = 'function_integer' THEN",
  "      to_regprocedure(format('public.%I(integer)', e.object_name)) IS NOT NULL",
  "    WHEN e.kind = 'function_zero' THEN",
  "      to_regprocedure(format('public.%I()', e.object_name)) IS NOT NULL",
  "    WHEN e.kind = 'column' THEN EXISTS (",
  "      SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid",
  "      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
  "      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')",
  "        AND c.relname = split_part(e.object_name,'.',1)",
  "        AND a.attname = split_part(e.object_name,'.',2) AND a.attnum>0 AND NOT a.attisdropped",
  "    )",
  "    WHEN e.kind = 'trigger' THEN EXISTS (",
  "      SELECT 1 FROM pg_catalog.pg_trigger t",
  "      JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid",
  "      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
  "      WHERE n.nspname='public' AND c.relname='audit_events'",
  "        AND t.tgname=e.object_name",
  "        AND NOT t.tgisinternal AND t.tgenabled <> 'D'",
  "    )",
  "    ELSE false",
  '  END AS "present"',
  "FROM expected e ORDER BY e.migration,e.kind,e.object_name",
].join("\n");

const entryKey = (row) => [row.migration, row.kind, row.objectName].join("|");

export function assessFoundationObjects(rows) {
  if (!Array.isArray(rows)) throw new Error("FOUNDATION_INVENTORY_UNAVAILABLE");
  const expected = new Set(FOUNDATION_OBJECTS.map(entryKey));
  const found = new Map();
  for (const row of rows) {
    const key = row && entryKey(row);
    if (!expected.has(key) || found.has(key) || typeof row.present !== "boolean") {
      throw new Error("FOUNDATION_INVENTORY_INCONSISTENT");
    }
    found.set(key, row.present);
  }
  if (found.size !== expected.size) throw new Error("FOUNDATION_INVENTORY_INCOMPLETE");
  const migrations = [...new Set(FOUNDATION_OBJECTS.map(x => x.migration))].map(file => {
    const missingObjects = FOUNDATION_OBJECTS.filter(x => x.migration === file && found.get(entryKey(x)) !== true)
      .map(x => x.kind + ":" + x.objectName);
    return {
      file, missingObjects,
      status: missingObjects.length ? "BLOCKED_MISSING_FOUNDATION_OBJECTS"
        : "EXPECTED_OBJECTS_PRESENT_NOT_MIGRATION_RECEIPT",
    };
  });
  return {
    migrations,
    allExpectedObjectsPresent: migrations.every(x => x.missingObjects.length === 0),
    productionMigrationApproved: false,
    evidenceType: "READ_ONLY_CATALOG_ONLY_NOT_EXECUTION_HISTORY",
  };
}
