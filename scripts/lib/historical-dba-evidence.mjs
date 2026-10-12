/**
 * P0-4 DBA evidence packet — read-only actual Neon catalog, exact Git file hashes.
 * A catalog match is NEVER an applied-SQL receipt or a release authorization.
 * Never select payroll, employee, government-ID or bank account rows.
 */
export const HISTORICAL_GROUPS=Object.freeze([
  {source:"drizzle/0022_job_architecture_positions.sql",
   tables:["job_profiles","workforce_plans","positions","position_assignments"],
   columns:[], indexes:[
     ["job_profiles","job_profiles_org_title_level_unique",true],
     ["positions","positions_org_code_unique",true],
     ["position_assignments","position_assignments_position_from_unique",true],
   ]},
  {source:"drizzle/0050_hcm_core_worker_history.sql",
   tables:["worker_employment_events"],columns:[
     ["positions","legal_entity_id","int4"],
     ["position_assignments","assignment_type","varchar"],
     ["position_assignments","fte","numeric"],
   ],indexes:[
     ["position_assignments","position_assignments_active_primary_employee_unique",true],
     ["worker_employment_events","worker_employment_events_employee_date_idx",false],
   ]},
  {source:"drizzle/0110_provider_events_inbox.sql",
   tables:["provider_events"],columns:[],indexes:[
     ["provider_events","provider_events_provider_event_id_unique",true],
   ]},
  {source:"drizzle/0112_wfm_operational_demand_observations.sql",
   tables:["workforce_demand_import_batches","workforce_demand_observation_revisions"],
   columns:[],indexes:[
     ["workforce_demand_import_batches","wfm_demand_import_idempotency_unique",true],
     ["workforce_demand_observation_revisions","wfm_demand_observation_version_unique",true],
   ]},
  {source:"drizzle/0113_wfm_issued_demand_forecasts.sql",
   tables:["workforce_demand_forecast_issues","workforce_demand_forecast_scores"],
   columns:[],indexes:[
     ["workforce_demand_forecast_issues","wfm_demand_issued_key_unique",true],
     ["workforce_demand_forecast_scores","wfm_demand_issued_score_unique",true],
   ]},
  {source:"drizzle/0114_wfm_demand_staffing_policies.sql",
   tables:["workforce_demand_staffing_policies","workforce_demand_staffing_policy_events"],
   columns:[],indexes:[
     ["workforce_demand_staffing_policies","wfm_staffing_policy_idempotency_unique",true],
     ["workforce_demand_staffing_policy_events","wfm_staffing_policy_event_unique",true],
   ]},
]);
export const PINNED_NEON=Object.freeze({
 projectId:"calm-wave-70219564",
 branchId:"br-lucky-sound-b79i56jw",
 endpointId:"ep-cool-hat-b7e7gpoo",
 database:"neondb",
 host:"ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech",
});

const ITEMS=Object.freeze(HISTORICAL_GROUPS.flatMap(group=>[
 ...group.tables.map(name=>({source:group.source,kind:"table",relation:name,member:"",dataType:"",unique:false})),
 ...group.columns.map(([rel,col,dataType])=>({source:group.source,kind:"column",relation:rel,member:col,dataType,unique:false})),
 ...group.indexes.map(([rel,idx,unique])=>({source:group.source,kind:"index",relation:rel,member:idx,dataType:"",unique})),
].map(x=>Object.freeze({...x,key:x.source+"|"+x.kind+"|"+x.relation+"|"+x.member}))));

export const HISTORICAL_ITEMS=ITEMS;
function refuse(code){throw new Error("P0_4_EVIDENCE_"+code);}
function sqlString(input){
 if(typeof input!=="string" || !/^[a-zA-Z0-9_./|:-]+$/.test(input))refuse("INVALID_STATIC_SQL");
 return "'"+input+"'";
}
const requiredValues=ITEMS.map(item=>[
 item.key,item.kind,item.relation,item.member||"-",item.dataType||"-",
].map(sqlString).join(", ")+", "+(item.unique?"true":"false"));
/** This is pure read-only catalog SQL; no row values from employer tables. */
export const HISTORICAL_CATALOG_QUERY=[
 "WITH expected(object_key,kind,table_name,member_name,type_name,require_unique) AS (VALUES",
 requiredValues.map(x=>" ("+x+")").join(",\n"),
 ") SELECT expected.object_key AS key,",
 " CASE WHEN expected.kind='table' THEN EXISTS (",
 "   SELECT 1 FROM pg_catalog.pg_class tbl",
 "   JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace",
 "   WHERE n.nspname='public' AND tbl.relname=expected.table_name",
 "     AND tbl.relkind IN ('r','p'))",
 " WHEN expected.kind='column' THEN EXISTS (",
 "   SELECT 1 FROM pg_catalog.pg_attribute a",
 "   JOIN pg_catalog.pg_class tbl ON tbl.oid=a.attrelid",
 "   JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace",
 "   WHERE n.nspname='public' AND tbl.relname=expected.table_name",
 "     AND tbl.relkind IN ('r','p')",
 "     AND a.attname=expected.member_name AND a.attnum>0 AND NOT a.attisdropped",
 "     AND a.atttypid=CASE expected.type_name",
 "       WHEN 'int4' THEN 'pg_catalog.int4'::pg_catalog.regtype",
 "       WHEN 'varchar' THEN 'pg_catalog.varchar'::pg_catalog.regtype",
 "       WHEN 'numeric' THEN 'pg_catalog.numeric'::pg_catalog.regtype",
 "       ELSE NULL END)",
 " WHEN expected.kind='index' THEN EXISTS (",
 "   SELECT 1 FROM pg_catalog.pg_index ix",
 "   JOIN pg_catalog.pg_class idx ON idx.oid=ix.indexrelid",
 "   JOIN pg_catalog.pg_class tbl ON tbl.oid=ix.indrelid",
 "   JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace",
 "   WHERE n.nspname='public' AND tbl.relname=expected.table_name",
 "     AND idx.relname=expected.member_name AND ix.indisvalid AND ix.indisready",
 "     AND ix.indisunique=expected.require_unique)",
 " ELSE false END AS present",
 "FROM expected ORDER BY expected.object_key",
].join("\n");

export const IDENTITY_QUERY=[
 "SELECT current_database() AS database_name,",
 " current_setting('neon.project_id',true) AS project_id,",
 " current_setting('neon.branch_id',true) AS branch_id,",
 " current_setting('neon.endpoint_id',true) AS endpoint_id,",
 " current_setting('transaction_read_only')='on' AS read_only,",
 " EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user",
 " AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) AS elevated,",
 " (pg_catalog.has_schema_privilege(current_user,'public','CREATE') OR",
 " pg_catalog.has_database_privilege(current_user,current_database(),'CREATE') OR",
 " EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n",
 " ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p')",
 " AND pg_catalog.has_table_privilege(current_user,c.oid,",
 " 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) AS has_write_privileges,",
 " EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n",
 " ON n.oid=c.relnamespace WHERE n.nspname='public' AND",
 " c.relname = ANY(ARRAY['employees','payroll_entries','payroll_runs','bank_accounts'])",
 " AND pg_catalog.has_any_column_privilege(current_user,c.oid,'SELECT')) AS can_read_sensitive_rows",
].join("\n");

export function buildHistoricalEvidence({inventory,catalogRows,metadata,capturedAt}){
 if(!inventory || !Array.isArray(inventory.files) || inventory.files.length<6 ||
    !/^[a-f0-9]{64}$/.test(inventory.digest||"") ||
    !Array.isArray(catalogRows) || typeof metadata!=="object" || metadata===null ||
    typeof capturedAt!=="string" || Number.isNaN(Date.parse(capturedAt))){
   refuse("INCOMPLETE_INPUT");
 }
 const originals=new Map(inventory.files.map(x=>[x.path,x]));
 const src=HISTORICAL_GROUPS.map(x=>{
  const found=originals.get(x.source);
  if(!found || !/^[a-f0-9]{64}$/.test(found.sha256||""))refuse("SOURCE_HASH_UNVERIFIED");
  return {path:x.source,sha256:found.sha256};
 });
 if(metadata.database_name!==PINNED_NEON.database ||
    metadata.project_id!==PINNED_NEON.projectId ||
    metadata.branch_id!==PINNED_NEON.branchId ||
    metadata.endpoint_id!==PINNED_NEON.endpointId ||
    metadata.read_only!==true || metadata.elevated!==false ||
    metadata.has_write_privileges!==false ||
    metadata.can_read_sensitive_rows!==false)refuse("WRONG_SOURCE_OR_ROLE");
 const expected=new Map(ITEMS.map(x=>[x.key,x]));
 const seen=new Map();
 for(const row of catalogRows){
  if(!row || typeof row.key!=="string" || !expected.has(row.key) ||
    typeof row.present!=="boolean" || seen.has(row.key))refuse("CATALOG_TRUNCATED_OR_AMBIGUOUS");
  seen.set(row.key,row.present);
 }
 if(seen.size!==ITEMS.length)refuse("CATALOG_TRUNCATED_OR_AMBIGUOUS");
 const gaps=ITEMS.filter(x=>!seen.get(x.key)).map(x=>({
   source:x.source,kind:x.kind,object:x.relation+(x.member?"."+x.member:"")
 }));
 return {
  kind:"p0-4-read-only-historical-schema-evidence",
  capturedAt,projectId:PINNED_NEON.projectId,branchId:PINNED_NEON.branchId,
  endpointId:PINNED_NEON.endpointId,database:PINNED_NEON.database,
  sourceManifestSha256:inventory.digest,historicalSourceFiles:src,
  inspectedObjects:ITEMS.length,presentObjects:ITEMS.length-gaps.length,
  missingObjects:gaps.length,gaps,
  authenticHistoricalReceiptsObserved:false,
  historicalSQLExecutionProven:false,
  payrollRecordsInspected:false,bankRecordsInspected:false,
  historicalEmploymentEventsRecovered:false,
  productionMigrationAuthorized:false,
  releaseBlocked:true,
 };
}

export async function inspectReadOnlyHistoricalEvidence({client,inventory,capturedAt}){
 if(!client || typeof client.query!=="function")refuse("NO_READONLY_CLIENT");
 let began=false;
 try{
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  began=true;
  await client.query("SET LOCAL statement_timeout='7000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const i=await client.query(IDENTITY_QUERY);
  if(i?.rows?.length!==1)refuse("IDENTITY_UNVERIFIED");
  const result=await client.query(HISTORICAL_CATALOG_QUERY);
  const report=buildHistoricalEvidence({inventory,catalogRows:result?.rows,metadata:i.rows[0],capturedAt});
  await client.query("ROLLBACK");
  began=false;
  return report;
 }catch(e){
  if(began){try{await client.query("ROLLBACK");}catch{/* drop connection */}}
  throw e;
 }
}
