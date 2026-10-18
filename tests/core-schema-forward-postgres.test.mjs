import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";
import pg from "pg";

const mode=process.env.ISSUE908_ACCEPTANCE_MODE;
const local=mode==="isolated-local-only";
const ready=local||mode==="isolated-ci-only";
if(mode&&!ready)throw Error("CORE_FORWARD_UNKNOWN_ACCEPTANCE_MODE");

test("0133 forward migration satisfies core read-only preflight and rejects guard drift",{skip:!ready,timeout:60000},async t=>{
 const outputRoot=resolve(import.meta.dirname,"../../../outputs");
 const data=resolve(process.env.ISSUE908_LOCAL_FIXTURE_DIR??"");
 const port=local?process.env.ISSUE908_LOCAL_PORT:"5432";
 if(local){
  assert.equal(process.platform,"win32");assert.match(port??"",/^54[0-9]{3}$/);
  assert.equal(dirname(dirname(data)),outputRoot);
  assert.match(basename(dirname(data)),/^issue908-[A-Za-z0-9-]+$/);
  assert.equal(basename(data),"data");
  assert.equal(realpathSync(data).toLowerCase(),data.toLowerCase());
  assert.equal(readFileSync(resolve(data,"ISSUE908_SYNTHETIC_ONLY"),"utf8"),"empty-fictional-fixture\n");
 }else{
  assert.equal(process.env.CI,"true");assert.equal(process.env.GITHUB_ACTIONS,"true");
 }
 const url=`postgresql://postgres:postgres@127.0.0.1:${port}/neondb`;
 assert.equal(process.env.DATABASE_URL,url);
 for(const key of ["PAYMONGO_DISBURSEMENTS_ENABLED","XENDIT_PAYOUTS_ENABLED"])assert.equal(process.env[key],"false");
 const {verifyCoreSchemaReadOnly,coreSchemaCompatibilityMode}=await import("../src/lib/core-schema-readonly.ts");
 const client=new pg.Client({connectionString:url,connectionTimeoutMillis:4000,query_timeout:10000});
 await client.connect();
 try{
  const initial=(await client.query(`SELECT current_database() AS db,current_setting('data_directory') AS dir,
   current_setting('server_version_num')::int AS version,
   (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')) AS objects,
   (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname IN ('payrollph_audit_sealing','payrollph_audit_maintenance')) AS roles`)).rows[0];
  assert.equal(initial.db,"neondb");assert.equal(initial.objects,0);assert.equal(initial.roles,0);
  assert.ok([16,18].includes(Math.floor(initial.version/10000)));
  if(local)assert.equal(resolve(initial.dir).toLowerCase(),data.toLowerCase());
  // Minimal fictional structural canary only; this is not full schema parity.
  await client.query(`CREATE ROLE payrollph_audit_sealing NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   CREATE ROLE payrollph_audit_maintenance NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   CREATE TABLE organizations(id integer PRIMARY KEY);
   CREATE TABLE users(id integer PRIMARY KEY);
   CREATE TABLE employees(id integer PRIMARY KEY);
   CREATE TABLE payroll_runs(id integer PRIMARY KEY);
   CREATE TABLE payroll_entries(id integer PRIMARY KEY);
   CREATE TABLE audit_events(id serial PRIMARY KEY,organization_id integer REFERENCES organizations(id),
    actor varchar(120) NOT NULL,action varchar(160) NOT NULL,resource varchar(160) NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
    chain_seq bigint,prev_hash varchar(64),row_hash varchar(64));
   CREATE TABLE compensation_automation_intents(organization_id integer,trigger text,event_key text);
   CREATE UNIQUE INDEX comp_automation_intent_key_unique ON compensation_automation_intents(organization_id,trigger,event_key);
   CREATE TABLE saas_signup_verifications(organization_id integer,token_hash text,verified_at timestamptz);
   CREATE TABLE saas_billing_checkouts(organization_id integer,reference_id text,status text);
   CREATE UNIQUE INDEX saas_billing_one_open_checkout ON saas_billing_checkouts(organization_id)
    WHERE status IN ('creating','awaiting_payment','review_required');
   CREATE TABLE saas_billing_state(subscription_id text);
   CREATE TABLE saas_billing_events(id integer PRIMARY KEY);
   CREATE TABLE provider_events(organization_id integer,provider text,event_id text);
   CREATE UNIQUE INDEX provider_events_provider_event_id_unique ON provider_events(provider,event_id);
   INSERT INTO organizations VALUES(1);
   INSERT INTO audit_events(organization_id,actor,action,resource) VALUES(1,'fictional-preserved','test','core-forward')`);
  const before=(await client.query("SELECT to_jsonb(e) AS row FROM audit_events e WHERE id=1")).rows[0].row;
  await client.query("BEGIN");
  try{
   await client.query("SELECT set_config('neon.project_id','calm-wave-70219564',true),set_config('neon.branch_id','br-lucky-sound-b79i56jw',true),set_config('neon.endpoint_id','ep-cool-hat-b7e7gpoo',true)");
   await client.query(readFileSync(new URL("../drizzle/0133_audit_missing_foundation_forward.sql",import.meta.url),"utf8"));
   await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}
  assert.deepEqual((await client.query("SELECT to_jsonb(e) AS row FROM audit_events e WHERE id=1")).rows[0].row,before);
  const verify=()=>verifyCoreSchemaReadOnly((sql,parameters)=>client.query(sql,parameters));
  await t.test("committed 0133 passes the actual read-only preflight and leaves no open transaction",async()=>{
   assert.equal(coreSchemaCompatibilityMode(undefined,{REQUEST_SCHEMA_READONLY_ENABLED:"true"}),"read-only");
   await verify();
   assert.equal((await client.query("SELECT current_setting('transaction_read_only') AS ro")).rows[0].ro,"off");
  });
  for(const name of ["audit_events_protect_mutation","audit_events_insert_guard_v2","audit_events_reject_truncate_v2"]){
   await t.test("disabled "+name+" refuses preflight",async()=>{
    await client.query(`ALTER TABLE audit_events DISABLE TRIGGER ${name}`);
    try{await assert.rejects(verify,/CORE_SCHEMA_READONLY_PRECONDITION_FAILED/);}
    finally{await client.query(`ALTER TABLE audit_events ENABLE TRIGGER ${name}`);}
    await verify();
   });
  }
  const mutation="CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_events_protect_v2()";
  for(const [name,apply,reset] of [
   ["conditional guard","DROP TRIGGER audit_events_protect_mutation ON audit_events; CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.audit_events_protect_v2()","DROP TRIGGER audit_events_protect_mutation ON audit_events; "+mutation],
   ["partial v2 with legacy mutation function","DROP TRIGGER audit_events_protect_mutation ON audit_events; CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_events_protect()","DROP TRIGGER audit_events_protect_mutation ON audit_events; "+mutation],
   ["missing insert guard","DROP TRIGGER audit_events_insert_guard_v2 ON audit_events","CREATE TRIGGER audit_events_insert_guard_v2 BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_events_insert_guard_v2()"],
   ["definer function","ALTER FUNCTION public.audit_events_protect_v2() SECURITY DEFINER","ALTER FUNCTION public.audit_events_protect_v2() SECURITY INVOKER"],
   ["unsafe search path","ALTER FUNCTION public.audit_events_protect_v2() RESET search_path","ALTER FUNCTION public.audit_events_protect_v2() SET search_path=pg_catalog"],
  ]) await t.test(name+" refuses preflight without legacy fallback",async()=>{
   await client.query(apply);
   try{await assert.rejects(verify,/CORE_SCHEMA_READONLY_PRECONDITION_FAILED/);}
   finally{await client.query(reset);}
   await verify();
  });
  assert.deepEqual((await client.query("SELECT to_jsonb(e) AS row FROM audit_events e WHERE id=1")).rows[0].row,before);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_chain_heads")).rows[0].n,0);
  await t.test("legacy-only guard remains compatible, but is never a partial-v2 fallback",async()=>{
   await client.query(`DROP TRIGGER audit_events_protect_mutation ON audit_events;
    DROP TRIGGER audit_events_insert_guard_v2 ON audit_events;
    DROP TRIGGER audit_events_reject_truncate_v2 ON audit_events;
    CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON audit_events
     FOR EACH ROW EXECUTE FUNCTION public.audit_events_protect()`);
   await assert.rejects(verify,/CORE_SCHEMA_READONLY_PRECONDITION_FAILED/);
   await client.query(`DROP FUNCTION public.audit_events_protect_v2();
    DROP FUNCTION public.audit_events_insert_guard_v2();
    DROP FUNCTION public.audit_events_reject_truncate_v2()`);
   await verify();
   await client.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_protect_mutation");
   await assert.rejects(verify,/CORE_SCHEMA_READONLY_PRECONDITION_FAILED/);
  });
 }finally{await client.end();}
});
