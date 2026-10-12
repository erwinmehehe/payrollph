/**
 * Read-only structural guard for historical SQL adoption.
 *
 * This is extra defense against a mistaken/fabricated "applied" receipt:
 * before a reviewed forward migration can run, the merged historical SQL
 * families must actually have their required tables/columns/unique indexes.
 *
 * Catalog presence does NOT prove the file ran. Historical per-file SHA,
 * independent DBA evidence, and source baseline approval are separate gates.
 *
 * Does not SELECT tenant, employee, payroll or banking rows.
 */
const GROUPS = Object.freeze([
  {
    prefix: 22, source: "drizzle/0022_job_architecture_positions.sql",
    tables: ["job_profiles","workforce_plans","positions","position_assignments"],
    columns: [],
    indexes: [
      ["job_profiles","job_profiles_org_title_level_unique",true],
      ["positions","positions_org_code_unique",true],
      ["position_assignments","position_assignments_position_from_unique",true],
    ],
  },
  {
    prefix: 50, source: "drizzle/0050_hcm_core_worker_history.sql",
    tables: ["worker_employment_events"],
    columns: [
      ["positions","legal_entity_id","int4"],
      ["position_assignments","assignment_type","varchar"],
      ["position_assignments","fte","numeric"],
    ],
    indexes: [
      ["position_assignments","position_assignments_active_primary_employee_unique",true],
      ["worker_employment_events","worker_employment_events_employee_date_idx",false],
    ],
  },
  {
    prefix: 110, source: "drizzle/0110_provider_events_inbox.sql",
    tables: ["provider_events"], columns: [],
    indexes: [["provider_events","provider_events_provider_event_id_unique",true]],
  },
  {
    prefix: 112, source: "drizzle/0112_wfm_operational_demand_observations.sql",
    tables: ["workforce_demand_import_batches","workforce_demand_observation_revisions"],
    columns: [], indexes: [
      ["workforce_demand_import_batches","wfm_demand_import_idempotency_unique",true],
      ["workforce_demand_observation_revisions","wfm_demand_observation_version_unique",true],
    ],
  },
  {
    prefix: 113, source: "drizzle/0113_wfm_issued_demand_forecasts.sql",
    tables: ["workforce_demand_forecast_issues","workforce_demand_forecast_scores"],
    columns: [], indexes: [
      ["workforce_demand_forecast_issues","wfm_demand_issued_key_unique",true],
      ["workforce_demand_forecast_scores","wfm_demand_issued_score_unique",true],
    ],
  },
  {
    prefix: 114, source: "drizzle/0114_wfm_demand_staffing_policies.sql",
    tables: ["workforce_demand_staffing_policies","workforce_demand_staffing_policy_events"],
    columns: [], indexes: [
      ["workforce_demand_staffing_policies","wfm_staffing_policy_idempotency_unique",true],
      ["workforce_demand_staffing_policy_events","wfm_staffing_policy_event_unique",true],
    ],
  },
]);

export const HISTORICAL_REQUIRED_OBJECTS = Object.freeze(GROUPS.flatMap(group => [
  ...group.tables.map(relation => ({
    key: group.prefix + ":table:" + relation, prefix: group.prefix,
    source: group.source, kind: "table", relation, name: "", type: "", unique: false,
  })),
  ...group.columns.map(([relation,name,type]) => ({
    key: group.prefix + ":column:" + relation + "." + name, prefix: group.prefix,
    source: group.source, kind: "column", relation, name, type, unique: false,
  })),
  ...group.indexes.map(([relation,name,unique]) => ({
    key: group.prefix + ":index:" + relation + "." + name, prefix: group.prefix,
    source: group.source, kind: "index", relation, name, type: "", unique,
  })),
]));

function fail(code) { throw new Error("REVIEWED_MIGRATION_" + code); }

function sqlLiteral(s) {
  if (typeof s !== "string" || !/^[a-z0-9_.:-]+$/.test(s)) {
    fail("HISTORICAL_CATALOG_SOURCE_INVALID");
  }
  return "'" + s + "'";
}

/**
 * Fixed author-supplied catalog SQL: no interpolated request/tenant data.
 * Check index ownership, uniqueness and validity, not merely its name.
 * Intentionally does not inspect index contents or any user-defined rows.
 */
export const HISTORICAL_CATALOG_SQL = [
  "WITH required(key,kind,relation_name,object_name,expected_type,expected_unique) AS (",
  "VALUES",
  HISTORICAL_REQUIRED_OBJECTS.map(r => " (" +
    [r.key,r.kind,r.relation,r.name||"none",r.type||"none"].map(sqlLiteral).join(", ") +
    ", " + (r.unique ? "true" : "false") + ")").join(",\n"),
  ")",
  'SELECT required.key AS "key",',
  "CASE",
  " WHEN required.kind = 'table' THEN EXISTS (",
  "   SELECT 1 FROM pg_catalog.pg_class c",
  "   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
  "   WHERE n.nspname='public' AND c.relname=required.relation_name",
  "     AND c.relkind IN ('r','p')",
  " )",
  " WHEN required.kind = 'column' THEN EXISTS (",
  "   SELECT 1 FROM pg_catalog.pg_attribute a",
  "   JOIN pg_catalog.pg_class c ON c.oid=a.attrelid",
  "   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
  "   WHERE n.nspname='public' AND c.relname=required.relation_name",
  "     AND c.relkind IN ('r','p')",
  "     AND a.attname=required.object_name AND a.attnum>0 AND NOT a.attisdropped",
  "     AND a.atttypid=CASE required.expected_type",
  "       WHEN 'int4' THEN 'pg_catalog.int4'::pg_catalog.regtype",
  "       WHEN 'varchar' THEN 'pg_catalog.varchar'::pg_catalog.regtype",
  "       WHEN 'numeric' THEN 'pg_catalog.numeric'::pg_catalog.regtype",
  "       ELSE NULL END",
  " )",
  " WHEN required.kind = 'index' THEN EXISTS (",
  "   SELECT 1 FROM pg_catalog.pg_index ix",
  "   JOIN pg_catalog.pg_class idx ON idx.oid=ix.indexrelid",
  "   JOIN pg_catalog.pg_class tbl ON tbl.oid=ix.indrelid",
  "   JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace",
  "   WHERE n.nspname='public' AND tbl.relname=required.relation_name",
  "     AND idx.relname=required.object_name",
  "     AND ix.indisvalid AND ix.indisready",
  "     AND ix.indisunique=required.expected_unique",
  " )",
  " ELSE false END AS \"matches\"",
  "FROM required ORDER BY required.key",
].join("\n");

export function evaluateHistoricalCatalog(rows, throughPrefix) {
  if (!Number.isInteger(throughPrefix) || throughPrefix < 0 ||
      throughPrefix > 9999 || !Array.isArray(rows)) {
    fail("HISTORICAL_CATALOG_UNVERIFIED");
  }
  const expected = new Map(HISTORICAL_REQUIRED_OBJECTS.map(x=>[x.key,x]));
  const present = new Map();
  for(const row of rows) {
    if (!row || typeof row.key !== "string" ||
        !expected.has(row.key) || present.has(row.key) ||
        typeof row.matches !== "boolean") {
      fail("HISTORICAL_CATALOG_UNVERIFIED");
    }
    present.set(row.key,row.matches);
  }
  // The SQL result must be exhaustive, including for future groups. A
  // truncated/partial result must never be interpreted as a passing audit.
  if(present.size !== expected.size) fail("HISTORICAL_CATALOG_UNVERIFIED");
  const relevant = HISTORICAL_REQUIRED_OBJECTS.filter(r=>r.prefix<=throughPrefix);
  const missing = relevant.filter(r=>!present.get(r.key));
  return {
    throughPrefix,
    checked: relevant.length,
    missing: missing.map(r=>({source:r.source,kind:r.kind,object:r.kind==="table"?r.relation:r.relation+"."+r.name})),
    structurallyReady: missing.length===0,
    historicalExecutionProven: false,
    productionReleaseApproved: false,
  };
}

export async function assertHistoricalCatalog(client, throughPrefix) {
  if (!client || typeof client.query !== "function") {
    fail("HISTORICAL_CATALOG_UNVERIFIED");
  }
  if(!Number.isInteger(throughPrefix) || throughPrefix<0 || throughPrefix>9999) {
    fail("HISTORICAL_CATALOG_UNVERIFIED");
  }
  if(throughPrefix<GROUPS[0].prefix) {
    return {throughPrefix,checked:0,missing:[],structurallyReady:true,
      historicalExecutionProven:false,productionReleaseApproved:false};
  }
  const result=await client.query(HISTORICAL_CATALOG_SQL);
  const evidence=evaluateHistoricalCatalog(result?.rows,throughPrefix);
  if(!evidence.structurallyReady)fail("HISTORICAL_CATALOG_OBJECTS_MISSING");
  return evidence;
}
