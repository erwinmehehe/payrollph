#!/usr/bin/env node
/**
 * P0 development-only fresh PostgreSQL 18 schema bootstrap catalog proof.
 * NEVER a historical SQL migration runner or production-schema cutover.
 * Preflight requires an empty GitHub CI PostgreSQL 18 on loopback app_db.
 * Post-push evidence uses catalog names, constraints and definitions only;
 * it never reads employee, bank, payroll or other application data rows.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT=resolve(ROOT,"qa-artifacts","fresh-pg18-dev-schema.json");
const TARGET="postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const REQUIRED_TABLES=Object.freeze([
  "organizations","users","user_organizations","sessions",
  "legal_entities","employees","employee_pay_profiles","time_punches",
  "workforce_timesheets","payroll_runs","payroll_entries","payslips",
  "audit_events","job_requisitions","first_payroll_journey_progress",
  "government_filing_validations",
]);
const FORBIDDEN_ENV=Object.freeze([
  "MIGRATION_TARGET_DATABASE_URL","NEON_DATABASE_URL",
  "PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY","OPENAI_API_KEY",
]);
const OFF_FLAGS=Object.freeze([
  "PAYMONGO_DISBURSEMENTS_ENABLED","XENDIT_PAYOUTS_ENABLED",
  "XENDIT_PAYOUTS_LIVE_APPROVED","FINAL_PAY_MANUAL_RELEASE_ENABLED",
  "WFM_GEOFENCE_PILOT_ENABLED","WFM_PUNCH_EVIDENCE_ENABLED",
]);

function reject(code){throw new Error("FRESH_PG18_DEV_"+code);}
export function assertDisposablePG18Environment(env){
  if(env.CI!=="true" || env.GITHUB_ACTIONS!=="true" ||
     env.FRESH_PG18_DEV_REHEARSAL!=="disposable-ci-only" ||
     env.DATABASE_URL!==TARGET || env.DEMO_MODE!=="false" ||
     FORBIDDEN_ENV.some(key=>Boolean(env[key])) ||
     OFF_FLAGS.some(key=>env[key]!=="false")){
    reject("UNSAFE_OR_UNAUTHORIZED_TARGET");
  }
  return Object.freeze({host:"127.0.0.1",database:"app_db",major:18});
}

export function assertCleanInitialCatalog(identity,relations){
  if(identity?.database!=="app_db" || identity?.role!=="postgres" ||
     !(identity.server>=180000 && identity.server<190000)){
    reject("WRONG_BACKEND_IDENTITY");
  }
  if(!Array.isArray(relations) || relations.length!==0){
    reject("NOT_A_FRESH_EMPTY_DATABASE");
  }
  return true;
}

export function summarizeSchema(relations,columns,constraints,indexes){
  const tableNames=new Set(relations.filter(x=>["r","p"].includes(x.kind)).map(x=>x.name));
  const missing=REQUIRED_TABLES.filter(x=>!tableNames.has(x));
  if(missing.length>0 || tableNames.size<70 || columns.length<150 ||
     constraints.length<40 || indexes.length<35){
    reject("DRIZZLE_BOOTSTRAP_INCOMPLETE");
  }
  const canonical={relations,columns,constraints,indexes};
  return Object.freeze({
    relationCount:relations.length,tableCount:tableNames.size,
    columnCount:columns.length,constraintCount:constraints.length,
    indexCount:indexes.length,missingRequired:missing,
    catalogSha256:createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  });
}

/**
 * The FK must match the *same* id, organization and employee, preventing a
 * COE document in another tenant from being attached to a confidential case.
 * Preserve the existing org/employee/id key and tenant-scoped COE reference.
 * The unsuccessful column-order experiment has been reverted.
 */
export function assertCOETenantReference(constraints) {
  const uniqueKey = constraints.find(x => x.relation === "documents" &&
    x.name === "documents_org_employee_id_hr_cases_unique");
  const fk = constraints.find(x => x.relation === "employee_hr_cases" &&
    x.name === "employee_hr_cases_coe_document_tenant_fk");
  const u=String(uniqueKey?.definition ?? "").replace(/"/g,"").replace(/\s+/g," ");
  const f=String(fk?.definition ?? "").replace(/"/g,"").replace(/\s+/g," ");
  if (!/^UNIQUE \(organization_id, employee_id, id\)$/i.test(u) ||
      !/^FOREIGN KEY \(organization_id, employee_id, coe_document_id\) REFERENCES (?:public\.)?documents\(organization_id, employee_id, id\)/i.test(f)) {
    reject("COE_TENANT_FK_MISMATCH");
  }
  return true;
}

async function readCatalog(client){
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try{
    const metadata=await client.query(
      "SELECT current_database() AS database,current_user AS role,current_setting('server_version_num')::integer AS server");
    const identity=metadata.rows[0];
    const relations=(await client.query(
      "SELECT c.relname AS name,c.relkind AS kind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') ORDER BY c.relname,c.relkind")).rows;
    const columns=(await client.query(
      "SELECT c.relname AS relation,a.attname AS column,pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS required,COALESCE(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'') AS default_expr,a.attidentity AS identity,a.attgenerated AS generated FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum")).rows;
    const constraints=(await client.query(
      "SELECT c.relname AS relation,k.conname AS name,k.contype AS kind,pg_catalog.pg_get_constraintdef(k.oid,true) AS definition FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname")).rows;
    const indexes=(await client.query(
      "SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM pg_catalog.pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
    await client.query("COMMIT");
    return {identity,relations,columns,constraints,indexes};
  }catch{
    await client.query("ROLLBACK").catch(()=>{});
    reject("READ_ONLY_CATALOG_QUERY_FAILED");
  }
}

async function main(){
  const mode=process.argv[2];
  if(!["preflight","capture"].includes(mode))reject("MODE_INVALID");
  assertDisposablePG18Environment(process.env);
  const {default:pg}=await import("pg");
  const client=new pg.Client({connectionString:TARGET,connectionTimeoutMillis:7000,query_timeout:15000});
  try{
    await client.connect();
    const catalog=await readCatalog(client);
    if(mode==="preflight"){
      assertCleanInitialCatalog(catalog.identity,catalog.relations);
      process.stdout.write("FRESH_PG18_PREFLIGHT_PASS (verified empty disposable loopback database)\n");
      return;
    }
    if(catalog.identity?.database!=="app_db" || catalog.identity?.role!=="postgres" ||
       catalog.identity?.server<180000 || catalog.identity?.server>=190000){
      reject("WRONG_BACKEND_IDENTITY");
    }
    assertCOETenantReference(catalog.constraints);
    const summary=summarizeSchema(catalog.relations,catalog.columns,catalog.constraints,catalog.indexes);
    const evidence={
      kind:"fictional-fresh-pg18-drizzle-source-schema-v1",
      phase:"after-first-push",result:"CATALOG_ONLY",
      ...summary,postgresMajor:18,database:"app_db",
      historicMigrationsReplayed:false,liveNeonConnected:false,
      employerDataRead:false,productionReleaseApproved:false,
    };
    if(mode==="capture"){
      await mkdir(dirname(OUTPUT),{recursive:true});
      await writeFile(OUTPUT,JSON.stringify(evidence,null,2)+"\n",{flag:"wx",mode:0o600});
      process.stdout.write("FRESH_PG18_SOURCE_SCHEMA_CAPTURED "+
        summary.tableCount+" tables sha256="+summary.catalogSha256+"\n");
      return;
    }

  }finally{
    await client.end().catch(()=>{});
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    const code=error instanceof Error && /^FRESH_PG18_DEV_[A-Z_]+$/.test(error.message)
      ?error.message:"FRESH_PG18_DEV_EXECUTION_FAILED";
    process.stderr.write(code+"\n");
    process.exitCode=1;
  });
}
