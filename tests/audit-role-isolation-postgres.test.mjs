import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import pg from "pg";
import {drizzle} from "drizzle-orm/node-postgres";

const mode=process.env.ISSUE908_ACCEPTANCE_MODE;
const local=mode==="isolated-local-only";
const ready=local||mode==="isolated-ci-only";
if(mode&&!ready) throw Error("ISSUE908_UNKNOWN_ACCEPTANCE_MODE");

test("actual restricted logins: audit grants, GUC spoofing and forward guards",{skip:!ready,timeout:120000},async t=>{
 if(!local){assert.equal(process.env.CI,"true");assert.equal(process.env.GITHUB_ACTIONS,"true");}
 const fixtureDir=resolve(import.meta.dirname,"../../../outputs/issue908-isolated-postgres/data");
 if(local){
  assert.equal(process.platform,"win32");
  assert.equal(resolve(process.env.ISSUE908_LOCAL_FIXTURE_DIR??""),fixtureDir);
  assert.equal(readFileSync(resolve(fixtureDir,"ISSUE908_SYNTHETIC_ONLY"),"utf8"),"empty-fictional-fixture\n");
 }
 const url=local?"postgresql://postgres:postgres@127.0.0.1:54908/neondb":"postgresql://postgres:postgres@127.0.0.1:5432/neondb";
 assert.equal(process.env.DATABASE_URL,url);
 for(const key of ["PAYMONGO_DISBURSEMENTS_ENABLED","XENDIT_PAYOUTS_ENABLED"])assert.equal(process.env[key],"false");
 const {LEGACY_AUDIT_ROLE_PROOF_SQL,STRICT_AUDIT_ROLE_PROOF_SQL,auditChainProtectionProven}=await import("../src/lib/audit-role-proof.ts");
 const {auditEvents}=await import("../src/db/schema.ts");
  const {dispatchAuditSealing}=await import("../src/lib/audit-sealer-connection.ts");
 const admin=new pg.Client({connectionString:url});await admin.connect();
 const clients=[];
 try{
  const {rows:[pre]}=await admin.query(`SELECT current_database() AS db,current_setting('data_directory') AS dir,
   current_setting('server_version_num')::int AS version,
   (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')) AS objects,
   (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname LIKE 'qa908_%' OR rolname IN ('payrollph_audit_sealing','payrollph_audit_maintenance')) AS roles`);
  assert.equal(pre.db,"neondb");assert.equal(pre.objects,0);assert.equal(pre.roles,0);
  assert.ok([16,18].includes(Math.floor(pre.version/10000)));
  if(local)assert.equal(resolve(pre.dir).toLowerCase(),fixtureDir.toLowerCase());
  await admin.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
   CREATE ROLE payrollph_audit_sealing NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   CREATE ROLE payrollph_audit_maintenance NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   CREATE TABLE public.organizations(id integer PRIMARY KEY);
   CREATE TABLE public.audit_events(id serial PRIMARY KEY,organization_id integer REFERENCES public.organizations(id) ON DELETE CASCADE,
    actor text NOT NULL,action text NOT NULL,resource text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
   INSERT INTO public.organizations VALUES(1),(2);
   INSERT INTO public.audit_events(organization_id,actor,action,resource) VALUES(1,'fictional-original','fixture','qa908')`);
  await admin.query(readFileSync(new URL("../drizzle/0109_tamper_evident_audit_chain.sql",import.meta.url),"utf8"));
  const credentials=new Map();
  for(const name of ["qa908_app","qa908_worker","qa908_sealer","qa908_maint"]){
   const password=randomBytes(24).toString("hex");credentials.set(name,password);
   await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  }
  await admin.query(`GRANT USAGE ON SCHEMA public TO qa908_app,qa908_worker,payrollph_audit_sealing,payrollph_audit_maintenance;
   GRANT SELECT,INSERT ON public.audit_events TO qa908_app,qa908_worker;
   GRANT USAGE ON public.audit_events_id_seq TO qa908_app,qa908_worker;
   GRANT SELECT,DELETE ON public.organizations TO qa908_app,qa908_worker;
   GRANT SELECT ON public.audit_events TO payrollph_audit_sealing,payrollph_audit_maintenance;
   GRANT UPDATE(chain_seq,prev_hash,row_hash) ON public.audit_events TO payrollph_audit_sealing;
   GRANT SELECT,INSERT,UPDATE ON public.audit_chain_heads TO payrollph_audit_sealing;
   GRANT UPDATE,DELETE ON public.audit_events TO payrollph_audit_maintenance;
   GRANT payrollph_audit_sealing TO qa908_sealer;
   GRANT payrollph_audit_maintenance TO qa908_maint`);
  const byName={};
  for(const[name,password]of credentials){const u=new URL(url);u.username=name;u.password=password;
   const c=new pg.Client({connectionString:u.href});await c.connect();clients.push(c);byName[name]=c;}
  const app=byName.qa908_app,worker=byName.qa908_worker,sealer=byName.qa908_sealer,maint=byName.qa908_maint;
  async function proof(c,strict=true){return auditChainProtectionProven((await c.query(strict?STRICT_AUDIT_ROLE_PROOF_SQL:LEGACY_AUDIT_ROLE_PROOF_SQL)).rows[0],strict);}
  async function transaction(c,fn){await c.query("BEGIN");try{return await fn();}finally{await c.query("ROLLBACK");}}
  const denied=(c,sql)=>transaction(c,()=>assert.rejects(()=>c.query(sql),e=>e.code==="42501"));
  await t.test("reproduce old metadata false-PASS and caller-controlled maintenance bypass",async()=>{
   await admin.query("GRANT UPDATE(actor) ON public.audit_events TO qa908_app");
   try{
    assert.equal(await proof(app,false),true);
    await transaction(app,async()=>{await app.query("SET LOCAL linaw.audit_maintenance='on'");
     assert.equal((await app.query("UPDATE public.audit_events SET actor='fictional-tamper' WHERE id=1")).rowCount,1);});
    assert.equal(await proof(app,true),false);
   }finally{await admin.query("REVOKE UPDATE(actor) ON public.audit_events FROM qa908_app");}
  });
  const candidateRaw=readFileSync(new URL("../docs/sql/issue908-audit-trigger-boundary-REVIEW_ONLY.sql",import.meta.url),"utf8");
  const candidate=candidateRaw.replaceAll("__ISSUE908_ISOLATED_BRANCH__","fictional-qa908");
  for(const [name,setup,sql,expected]of [
   ["unreplaced review marker","",candidateRaw,/ISOLATED_REVIEW_ONLY/],
   ["excluded production target","SELECT set_config('neon.branch_id','br-lucky-sound-b79i56jw',true)",candidate,/ISOLATED_REVIEW_ONLY/],
   ["missing chain-head prerequisite","ALTER TABLE public.audit_chain_heads RENAME TO qa908_saved_heads",candidate,/FOUNDATION_AND_HISTORY_REQUIRED/],
   ["inherited trusted group","ALTER ROLE payrollph_audit_sealing INHERIT",candidate,/TRUSTED_NONLOGIN_GROUPS_REQUIRED/],
   ["trusted group escalation","GRANT pg_read_all_data TO payrollph_audit_sealing",candidate,/TRUSTED_GROUP_ESCALATION/],
  ])await t.test("forward candidate rejects "+name,()=>transaction(admin,async()=>{
   await admin.query("SELECT set_config('neon.project_id','calm-wave-70219564',true),set_config('neon.branch_id','fictional-qa908',true)");
   if(setup)await admin.query(setup);
   await assert.rejects(()=>admin.query(sql),e=>e.code==="P0001"&&expected.test(e.message));
  }));
  await admin.query("BEGIN");
  try{
   await admin.query("SELECT set_config('neon.project_id','calm-wave-70219564',true),set_config('neon.branch_id','fictional-qa908',true)");
   await admin.query(candidate);
   await admin.query("COMMIT");
  }catch(e){await admin.query("ROLLBACK");throw e;}
  await t.test("forward candidate replay refuses before changing existing guards",()=>transaction(admin,async()=>{
   await admin.query("SELECT set_config('neon.project_id','calm-wave-70219564',true),set_config('neon.branch_id','fictional-qa908',true)");
   await assert.rejects(()=>admin.query(candidate),e=>e.code==="P0001"&&/FORWARD_REPLAY_OR_PARTIAL_STATE/.test(e.message));
  }));
  for(const[name,c]of [["app",app],["worker",worker]]){
   await t.test(name+" genuine login passes stronger metadata proof",async()=>assert.equal(await proof(c),true));
   await t.test(name+" actual Drizzle writer appends unsealed evidence",()=>transaction(c,async()=>{
    await drizzle(c).insert(auditEvents).values({organizationId:1,actor:"fictional-runtime",action:"append",resource:"qa908",metadata:{}});
    assert.equal((await c.query("SELECT count(*)::int AS n FROM public.audit_events WHERE chain_seq IS NULL")).rows[0].n,2);
   }));
   for(const[label,sql]of [
    ["spoof maintenance","SET LOCAL linaw.audit_maintenance='on'; UPDATE public.audit_events SET actor='tamper' WHERE id=1"],
    ["spoof sealing","SET LOCAL linaw.audit_sealing='on'; UPDATE public.audit_events SET chain_seq=9 WHERE id=1"],
    ["delete","DELETE FROM public.audit_events WHERE id=1"],
    ["truncate","TRUNCATE public.audit_events"],
    ["head insert","INSERT INTO public.audit_chain_heads(chain_key) VALUES(99)"],
    ["head update","UPDATE public.audit_chain_heads SET last_seq=99"],
    ["head delete","DELETE FROM public.audit_chain_heads"],
    ["disable trigger","ALTER TABLE public.audit_events DISABLE TRIGGER ALL"],
    ["DDL","CREATE TABLE public.qa908_escape(id integer)"],
    ["replication hint","SET LOCAL session_replication_role='replica'"],
    ["assume maintainer","SET LOCAL ROLE payrollph_audit_maintenance"],
    ["assume sealer","SET LOCAL ROLE payrollph_audit_sealing"],
    ["grant maintenance","GRANT payrollph_audit_maintenance TO "+(name==="app"?"qa908_app":"qa908_worker")],
    ["forge presealed insert","INSERT INTO public.audit_events(organization_id,actor,action,resource,chain_seq) VALUES(1,'forged','fixture','qa908',5)"],
    ["organization cascade","DELETE FROM public.organizations WHERE id=1"],
    ["invoke privileged sealer","SELECT public.seal_audit_events(10)"],
   ]) await t.test(name+": "+label+" denied",()=>denied(c,sql));
  }
  await t.test("an accidental column UPDATE grant cannot revive GUC bypass",async()=>{
   await admin.query("GRANT UPDATE(actor) ON public.audit_events TO qa908_app");
   try{assert.equal(await proof(app),false);await denied(app,"SET LOCAL linaw.audit_maintenance='on'; UPDATE public.audit_events SET actor='tamper' WHERE id=1");}
   finally{await admin.query("REVOKE UPDATE(actor) ON public.audit_events FROM qa908_app");}
   assert.equal(await proof(app),true);
  });
  await t.test("TRUNCATE trigger backstops an accidental ACL grant",async()=>{
   await admin.query("GRANT TRUNCATE ON public.audit_events TO qa908_app");
   try{assert.equal(await proof(app),false);await denied(app,"TRUNCATE public.audit_events");}
   finally{await admin.query("REVOKE TRUNCATE ON public.audit_events FROM qa908_app");}
  });
  async function changed(name,apply,reset){
   await t.test(name,async()=>{await admin.query(apply);
    try{assert.equal(await proof(app),false);}finally{await admin.query(reset);}
    assert.equal(await proof(app),true);
   });
  }
  await changed("column-only head INSERT cannot bypass table privilege checks",
   "GRANT INSERT(last_seq) ON public.audit_chain_heads TO qa908_app",
   "REVOKE INSERT(last_seq) ON public.audit_chain_heads FROM qa908_app");
  await changed("PUBLIC column UPDATE is effective mutation access",
   "GRANT UPDATE(actor) ON public.audit_events TO PUBLIC","REVOKE UPDATE(actor) ON public.audit_events FROM PUBLIC");
  await changed("NOINHERIT privileged membership still fails proof",
   "GRANT payrollph_audit_maintenance TO qa908_app","REVOKE payrollph_audit_maintenance FROM qa908_app");
  await changed("replication-role SET permission fails proof",
   "GRANT SET ON PARAMETER session_replication_role TO qa908_app","REVOKE SET ON PARAMETER session_replication_role FROM qa908_app");
  await changed("CREATE in a non-public schema fails proof",
   "CREATE SCHEMA qa908_extra; GRANT CREATE ON SCHEMA qa908_extra TO qa908_app",
   "DROP SCHEMA qa908_extra");
  await changed("PUBLIC SECURITY DEFINER execution fails proof",
   "CREATE FUNCTION public.qa908_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
   "DROP FUNCTION public.qa908_definer()");
  if(pre.version>=170000)await changed("MAINTAIN cannot bypass the audit privilege boundary",
   "GRANT MAINTAIN ON public.audit_events TO qa908_app","REVOKE MAINTAIN ON public.audit_events FROM qa908_app");
  for(const name of ["audit_events_insert_guard_v2","audit_events_reject_truncate_v2"])
   await changed(name+" must remain enabled","ALTER TABLE public.audit_events DISABLE TRIGGER "+name,
    "ALTER TABLE public.audit_events ENABLE TRIGGER "+name);
  await t.test("same trigger name with a different function cannot spoof proof",async()=>{
   await admin.query(`CREATE FUNCTION public.qa908_noop() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
    DROP TRIGGER audit_events_protect_mutation ON public.audit_events;
    CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.qa908_noop()`);
   try{assert.equal(await proof(app,false),true);assert.equal(await proof(app),false);}
   finally{await admin.query(`DROP TRIGGER audit_events_protect_mutation ON public.audit_events;
    CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_events_protect_v2();
    DROP FUNCTION public.qa908_noop()`);}
  });
  const appUrl=new URL(url);appUrl.username="qa908_app";appUrl.password=credentials.get("qa908_app");
  const sealerUrl=new URL(url);sealerUrl.username="qa908_sealer";sealerUrl.password=credentials.get("qa908_sealer");
  const sealerEnv={NODE_ENV:"production",DATABASE_URL:appUrl.href,AUDIT_SEALER_DATABASE_URL:sealerUrl.href,AUDIT_ROLE_ISOLATION_PROOF_ENABLED:"true"};
  const seal=()=>dispatchAuditSealing(async()=>{throw Error("unexpected legacy route");},config=>new pg.Client(config),10,sealerEnv);
  for(const[name,apply,reset]of [
   ["sealer login with direct audit mutation","GRANT UPDATE(actor) ON public.audit_events TO qa908_sealer","REVOKE UPDATE(actor) ON public.audit_events FROM qa908_sealer"],
   ["sealer group with business field mutation","GRANT UPDATE(actor) ON public.audit_events TO payrollph_audit_sealing","REVOKE UPDATE(actor) ON public.audit_events FROM payrollph_audit_sealing"],
   ["sealer login with maintenance membership","GRANT payrollph_audit_maintenance TO qa908_sealer","REVOKE payrollph_audit_maintenance FROM qa908_sealer"],
   ["sealer group with schema CREATE","GRANT CREATE ON SCHEMA public TO payrollph_audit_sealing","REVOKE CREATE ON SCHEMA public FROM payrollph_audit_sealing"],
  ])await t.test("dedicated connection refuses "+name,async()=>{
   await admin.query(apply);try{await assert.rejects(seal,e=>e.message==="AUDIT_SEALER_BOUNDARY_NOT_READY");}
   finally{await admin.query(reset);}
   assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.audit_events WHERE chain_seq IS NOT NULL")).rows[0].n,0);
  });
  await t.test("actual dispatcher rolls back a failed sealing transaction",async()=>{
   await admin.query("REVOKE UPDATE(chain_seq) ON public.audit_events FROM payrollph_audit_sealing");
   try{await assert.rejects(seal,e=>e.message==="AUDIT_SEALER_BOUNDARY_NOT_READY");}
   finally{await admin.query("GRANT UPDATE(chain_seq) ON public.audit_events TO payrollph_audit_sealing");}
   assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.audit_events WHERE chain_seq IS NOT NULL")).rows[0].n,0);
   assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.audit_chain_heads")).rows[0].n,0);
  });
  await t.test("actual production dispatcher uses a dedicated login and unchanged 0109 sealer",async()=>{
   assert.equal(await seal(),1);
   assert.equal(await seal(),0);
  });
  await t.test("sealer cannot use maintenance hint to rewrite sealed evidence",()=>transaction(sealer,async()=>{
   await sealer.query("SET LOCAL ROLE payrollph_audit_sealing; SET LOCAL linaw.audit_maintenance='on'");
   await assert.rejects(()=>sealer.query("UPDATE public.audit_events SET row_hash=repeat('f',64) WHERE id=1"),e=>e.code==="42501");
  }));
  await t.test("maintenance membership without explicit hint is insufficient",()=>transaction(maint,async()=>{
   await maint.query("SET LOCAL ROLE payrollph_audit_maintenance");
   await assert.rejects(()=>maint.query("UPDATE public.audit_events SET actor='unapproved' WHERE id=1"),e=>e.code==="42501");
  }));
  await t.test("explicit trusted maintenance path works and rolls back",()=>transaction(maint,async()=>{
   await maint.query("SET LOCAL ROLE payrollph_audit_maintenance; SET LOCAL linaw.audit_maintenance='on'");
   assert.equal((await maint.query("UPDATE public.audit_events SET actor='approved-fictional-maintenance' WHERE id=1")).rowCount,1);
  }));
  const {rows:[final]}=await admin.query("SELECT count(*)::int AS n,min(actor) AS actor,bool_and(row_hash=public.audit_event_row_hash(prev_hash,chain_seq,id,organization_id,actor,action,resource,metadata,created_at)) AS intact FROM public.audit_events");
  assert.deepEqual(final,{n:1,actor:"fictional-original",intact:true});
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.organizations")).rows[0].n,2);
 }finally{for(const c of clients)await c.end();await admin.end();}
 // The dedicated disposable service is destroyed. No live role cleanup exists.
});
