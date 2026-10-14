import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  assertDisposablePG18Environment,assertCleanInitialCatalog,summarizeSchema,
} from "../scripts/qa/fresh-pg18-development-schema.mjs";

const safe=Object.freeze({
  CI:"true",GITHUB_ACTIONS:"true",FRESH_PG18_DEV_REHEARSAL:"disposable-ci-only",
  DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  DEMO_MODE:"false",
  PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",
  XENDIT_PAYOUTS_LIVE_APPROVED:"false",
  FINAL_PAY_MANUAL_RELEASE_ENABLED:"false",
  WFM_GEOFENCE_PILOT_ENABLED:"false",WFM_PUNCH_EVIDENCE_ENABLED:"false",
});
const required=["organizations","users","user_organizations","sessions",
"legal_entities","employees","employee_pay_profiles","time_punches",
"workforce_timesheets","payroll_runs","payroll_entries","payslips",
"audit_events","job_requisitions","first_payroll_journey_progress",
"government_filing_validations"];
const forbidden=(fn,code)=>assert.throws(fn,new RegExp("FRESH_PG18_DEV_"+code));

test("preflight accepts only exact isolated GitHub PG18 and explicitly disables money/providers",()=>{
  assert.deepEqual(assertDisposablePG18Environment(safe),
    {host:"127.0.0.1",database:"app_db",major:18});
  for(const delta of [
    {DATABASE_URL:"postgresql://postgres:postgres@localhost:5432/app_db"},
    {DATABASE_URL:"postgresql://owner:key@neon.example/neondb"},
    {DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/neondb"},
    {DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db?host=neon.example"},
    {GITHUB_ACTIONS:"false"}, {CI:"false"}, {DEMO_MODE:"true"},
    {FRESH_PG18_DEV_REHEARSAL:""},
    {MIGRATION_TARGET_DATABASE_URL:"postgresql://prod"},
    {NEON_DATABASE_URL:"postgresql://prod"},
    {PAYMONGO_SECRET_KEY:"provider-token"},
    {XENDIT_SECRET_KEY:"provider-token"},
    {OPENAI_API_KEY:"provider-token"},
    {XENDIT_PAYOUTS_ENABLED:"true"},
    {PAYMONGO_DISBURSEMENTS_ENABLED:"true"},
    {FINAL_PAY_MANUAL_RELEASE_ENABLED:"true"},
  ]) forbidden(()=>assertDisposablePG18Environment({...safe,...delta}),"UNSAFE_OR_UNAUTHORIZED_TARGET");
});

test("rejects PG16, real database identity, and any populated original source",()=>{
  const pg18={database:"app_db",role:"postgres",server:180005};
  assert.equal(assertCleanInitialCatalog(pg18,[]),true);
  for(const identity of [
    {...pg18,server:160011},{...pg18,server:190000},
    {...pg18,database:"neondb"},{...pg18,role:"neondb_owner"},
  ]) forbidden(()=>assertCleanInitialCatalog(identity,[]),"WRONG_BACKEND_IDENTITY");
  forbidden(()=>assertCleanInitialCatalog(pg18,[{name:"organizations",kind:"r"}]),"NOT_A_FRESH_EMPTY_DATABASE");
});

function fixture(){
  const rows=required.map(name=>({name,kind:"r"}));
  for(let i=0;i<70;i++)rows.push({name:"synthetic_table_"+i,kind:"r"});
  const columns=Array.from({length:200},(_,i)=>({relation:"synthetic_table_0",column:"field_"+i,data_type:"integer",required:true,default_expr:"",identity:"",generated:""}));
  const constraints=Array.from({length:50},(_,i)=>({relation:"synthetic_table_0",name:"check_"+i,kind:"c",definition:"CHECK (true)"}));
  const indexes=Array.from({length:50},(_,i)=>({table_name:"synthetic_table_0",name:"idx_"+i,definition:"CREATE INDEX idx ON synthetic_table_0"}));
  return {rows,columns,constraints,indexes};
}

test("complete source schema has a stable digest including column, index and constraint definitions",()=>{
  const f=fixture();
  const a=summarizeSchema(f.rows,f.columns,f.constraints,f.indexes);
  assert.equal(a.missingRequired.length,0);
  assert.match(a.catalogSha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(a,summarizeSchema(f.rows,f.columns,f.constraints,f.indexes));
  f.columns[0].data_type="text";
  const b=summarizeSchema(f.rows,f.columns,f.constraints,f.indexes);
  assert.notEqual(b.catalogSha256,a.catalogSha256);
  f.columns[0].data_type="integer";
  f.constraints[0].definition="CHECK (false)";
  assert.notEqual(summarizeSchema(f.rows,f.columns,f.constraints,f.indexes).catalogSha256,a.catalogSha256);
  f.constraints[0].definition="CHECK (true)";
  f.indexes[0].definition="CREATE UNIQUE INDEX idx ON synthetic_table_0";
  assert.notEqual(summarizeSchema(f.rows,f.columns,f.constraints,f.indexes).catalogSha256,a.catalogSha256);
});

test("a silent/partial Drizzle push cannot pass the development contract",()=>{
  const f=fixture();
  forbidden(()=>summarizeSchema([],[],[],[]),"DRIZZLE_BOOTSTRAP_INCOMPLETE");
  forbidden(()=>summarizeSchema(f.rows.filter(r=>r.name!=="payroll_runs"),f.columns,f.constraints,f.indexes),"DRIZZLE_BOOTSTRAP_INCOMPLETE");
  forbidden(()=>summarizeSchema(f.rows.slice(0,20),f.columns,f.constraints,f.indexes),"DRIZZLE_BOOTSTRAP_INCOMPLETE");
  forbidden(()=>summarizeSchema(f.rows,f.columns,f.constraints,[]),"DRIZZLE_BOOTSTRAP_INCOMPLETE");
});

test("guard is catalog-only, immutable and not a historical migration executor",()=>{
  const source=readFileSync(new URL("../scripts/qa/fresh-pg18-development-schema.mjs",import.meta.url),"utf8");
  assert.match(source,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source,/current_setting\('server_version_num'\)/);
  assert.match(source,/catalogSha256/);
  assert.match(source,/SECOND_PUSH_CHANGED_SCHEMA/);
  assert.doesNotMatch(source,/\b(?:INSERT INTO|DELETE FROM|TRUNCATE TABLE|CREATE TABLE|ALTER TABLE|DROP TABLE)\b/i);
  assert.doesNotMatch(source,/pg_dump|NeonClient|aws s3api|fetch\("https:\/\//i);
});
