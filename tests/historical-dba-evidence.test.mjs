import assert from "node:assert/strict";
import test from "node:test";
import { inventoryMigrationSources } from "../scripts/lib/migration-receipt-audit.mjs";
import {
  HISTORICAL_ITEMS, HISTORICAL_GROUPS, PINNED_NEON,
  HISTORICAL_CATALOG_QUERY, IDENTITY_QUERY,
  buildHistoricalEvidence, inspectReadOnlyHistoricalEvidence,
} from "../scripts/lib/historical-dba-evidence.mjs";

const manifest=()=>inventoryMigrationSources("drizzle");
const rows=()=>HISTORICAL_ITEMS.map(x=>({key:x.key,present:true}));
const identity=()=>({
 database_name:PINNED_NEON.database,
 project_id:PINNED_NEON.projectId,
 branch_id:PINNED_NEON.branchId,
 endpoint_id:PINNED_NEON.endpointId,
 read_only:true,elevated:false,
 has_write_privileges:false,can_read_sensitive_rows:false,
});
const at="2026-10-12T07:40:00.000Z";

test("DBA evidence maps exactly six historical Git sources and unique catalog keys",()=>{
  assert.deepEqual(HISTORICAL_GROUPS.map(x=>x.source),[
    "drizzle/0022_job_architecture_positions.sql",
    "drizzle/0050_hcm_core_worker_history.sql",
    "drizzle/0110_provider_events_inbox.sql",
    "drizzle/0112_wfm_operational_demand_observations.sql",
    "drizzle/0113_wfm_issued_demand_forecasts.sql",
    "drizzle/0114_wfm_demand_staffing_policies.sql",
  ]);
  assert.equal(HISTORICAL_ITEMS.length,new Set(HISTORICAL_ITEMS.map(x=>x.key)).size);
  assert.ok(HISTORICAL_ITEMS.some(x=>x.kind==="table"&&x.relation==="worker_employment_events"));
  assert.ok(HISTORICAL_ITEMS.some(x=>x.kind==="index"&&x.member==="provider_events_provider_event_id_unique"));
  assert.ok(HISTORICAL_ITEMS.some(x=>x.kind==="column"&&x.member==="fte"&&x.dataType==="numeric"));
});

test("complete matching source and catalog STILL cannot approve or infer historical application",()=>{
  const data=buildHistoricalEvidence({inventory:manifest(),catalogRows:rows(),metadata:identity(),capturedAt:at});
  assert.equal(data.inspectedObjects,HISTORICAL_ITEMS.length);
  assert.equal(data.presentObjects,HISTORICAL_ITEMS.length);
  assert.equal(data.missingObjects,0);
  assert.equal(data.historicalSourceFiles.length,6);
  for(const f of data.historicalSourceFiles)assert.match(f.sha256,/^[a-f0-9]{64}$/);
  assert.match(data.sourceManifestSha256,/^[a-f0-9]{64}$/);
  assert.equal(data.historicalSQLExecutionProven,false);
  assert.equal(data.authenticHistoricalReceiptsObserved,false);
  assert.equal(data.historicalEmploymentEventsRecovered,false);
  assert.equal(data.productionMigrationAuthorized,false);
  assert.equal(data.releaseBlocked,true);
  assert.equal(data.payrollRecordsInspected,false);
  assert.equal(data.bankRecordsInspected,false);
});

test("absent job, worker, provider and staffing objects appear as source-labeled gaps",()=>{
  const absent=new Set([
    "job_profiles","worker_employment_events","provider_events",
    "workforce_demand_staffing_policies",
  ]);
  const observations=rows().map(x=>{
    const definition=HISTORICAL_ITEMS.find(y=>y.key===x.key);
    return absent.has(definition.relation)&&definition.kind==="table"?
      {...x,present:false}:x;
  });
  const report=buildHistoricalEvidence({
    inventory:manifest(),catalogRows:observations,metadata:identity(),capturedAt:at,
  });
  assert.equal(report.missingObjects,4);
  assert.deepEqual(report.gaps.map(x=>x.object),[
    "job_profiles","worker_employment_events","provider_events",
    "workforce_demand_staffing_policies",
  ]);
  assert.ok(report.gaps.every(x=>x.source.startsWith("drizzle/")));
  assert.equal(report.releaseBlocked,true);
});

test("invalid inputs, partial/malformed catalog or missing Git SHA fail closed",()=>{
 const good={inventory:manifest(),catalogRows:rows(),metadata:identity(),capturedAt:at};
 for(const extra of [
  {catalogRows:null},
  {catalogRows:rows().slice(1)},
  {catalogRows:[...rows(),rows()[0]]},
  {catalogRows:rows().map((x,i)=>i===0?{...x,key:"unknown"}:x)},
  {catalogRows:rows().map((x,i)=>i===0?{...x,present:"true"}:x)},
  {metadata:null},
  {capturedAt:"not-a-date"},
 ])assert.throws(()=>buildHistoricalEvidence({...good,...extra}),
     /P0_4_EVIDENCE_(?:INCOMPLETE_INPUT|CATALOG_TRUNCATED_OR_AMBIGUOUS)/);
 const bogus=manifest();
 bogus.files=bogus.files.filter(f=>f.path!==HISTORICAL_GROUPS[0].source);
 assert.throws(()=>buildHistoricalEvidence({...good,inventory:bogus}),/P0_4_EVIDENCE_SOURCE_HASH_UNVERIFIED/);
});

test("incorrect project, branch, endpoint or privileged DB role rejects schema evidence",()=>{
 for(const bad of [
  {project_id:"calm-wave-other"},
  {branch_id:"br-other-branch"},
  {endpoint_id:"ep-other"},
  {database_name:"postgres"},
  {read_only:false},
  {elevated:true},
  {has_write_privileges:true},
  {can_read_sensitive_rows:true},
 ])assert.throws(()=>buildHistoricalEvidence({
  inventory:manifest(),catalogRows:rows(),
  metadata:{...identity(),...bad},capturedAt:at,
 }),/P0_4_EVIDENCE_WRONG_SOURCE_OR_ROLE/);
});

test("pg_catalog statements inspect schema only, not employee/payroll data",()=>{
 assert.match(HISTORICAL_CATALOG_QUERY,/pg_catalog\.pg_index/);
 assert.match(HISTORICAL_CATALOG_QUERY,/ix\.indisvalid AND ix\.indisready/);
 assert.match(HISTORICAL_CATALOG_QUERY,/ix\.indisunique=expected\.require_unique/);
 assert.match(IDENTITY_QUERY,/neon\.project_id/);
 assert.match(IDENTITY_QUERY,/neon\.branch_id/);
 assert.match(IDENTITY_QUERY,/neon\.endpoint_id/);
 for(const query of [HISTORICAL_CATALOG_QUERY,IDENTITY_QUERY]){
  assert.doesNotMatch(query,/^\s*(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE|CREATE\s+TABLE)\b/im);
  assert.doesNotMatch(query,/\bFROM\s+(?:public\.)?(?:payroll_runs|payroll_entries|employees|bank_accounts)\b/i);
 }
});

test("transactional collector always rolls back and never reads business rows",async()=>{
 const seen=[];
 const client={async query(sql){
   seen.push(sql);
   if(sql===IDENTITY_QUERY)return {rows:[identity()]};
   if(sql===HISTORICAL_CATALOG_QUERY)return {rows:rows()};
   return {rows:[]};
 }};
 const report=await inspectReadOnlyHistoricalEvidence({client,inventory:manifest(),capturedAt:at});
 assert.equal(report.releaseBlocked,true);
 assert.deepEqual(seen,[
   "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
   "SET LOCAL statement_timeout='7000ms'",
   "SET LOCAL lock_timeout='2000ms'",
   IDENTITY_QUERY,HISTORICAL_CATALOG_QUERY,"ROLLBACK",
 ]);
});

test("invalid catalog and wrong role both force rollback, no receipt ever generated",async()=>{
 for(const broken of [
  {metadata:identity(),catalogRows:rows().slice(1)},
  {metadata:{...identity(),elevated:true},catalogRows:rows()},
 ]) {
   const sql=[];
   const client={async query(s){
     sql.push(s);
     if(s===IDENTITY_QUERY)return {rows:[broken.metadata]};
     if(s===HISTORICAL_CATALOG_QUERY)return {rows:broken.catalogRows};
     return {rows:[]};
   }};
   await assert.rejects(()=>inspectReadOnlyHistoricalEvidence({
     client,inventory:manifest(),capturedAt:at,
   }),/P0_4_EVIDENCE_(WRONG_SOURCE_OR_ROLE|CATALOG_TRUNCATED_OR_AMBIGUOUS)/);
   assert.equal(sql.at(-1),"ROLLBACK");
   assert.equal(sql.includes("COMMIT"),false);
 }
});
