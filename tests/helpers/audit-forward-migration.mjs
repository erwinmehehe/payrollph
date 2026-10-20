import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Called only after the acceptance harness has verified an empty fictional cluster.
// Every probe rolls back its DDL, grants, role identities and synthetic row edits.
export async function exerciseAuditForwardMigration(t, admin) {
 const migration=readFileSync(new URL("../../drizzle/0133_audit_missing_foundation_forward.sql",import.meta.url),"utf8");
 const identity="SELECT set_config('neon.project_id','calm-wave-70219564',true),set_config('neon.branch_id','br-lucky-sound-b79i56jw',true),set_config('neon.endpoint_id','ep-cool-hat-b7e7gpoo',true)";
 async function fixture(fn) {
  await admin.query("BEGIN");
  try {
   await admin.query(identity);
   await admin.query("ALTER TABLE public.audit_events ADD COLUMN chain_seq bigint,ADD COLUMN prev_hash varchar(64),ADD COLUMN row_hash varchar(64)");
   await fn();
  } finally { await admin.query("ROLLBACK"); }
  assert.equal((await admin.query("SELECT to_regclass('public.audit_chain_heads') AS heads")).rows[0].heads,null);
  assert.equal((await admin.query("SELECT actor FROM public.audit_events WHERE id=1")).rows[0].actor,"fictional-original");
 }
 for(const key of ["project_id","branch_id","endpoint_id"]){
  await t.test("0133 rejects mismatched "+key,()=>fixture(async()=>{
   await admin.query("SELECT set_config($1,'wrong-target',true)",["neon."+key]);
   await assert.rejects(()=>admin.query(migration),/ISSUE908_FORWARD_TARGET_MISMATCH/);
  }));
 }
 for(const [name,setup,error] of [
  ["partial foundation","CREATE TABLE public.audit_chain_heads(id integer)",/MISSING_OR_PARTIAL_STATE/],
  ["chain evidence","UPDATE public.audit_events SET chain_seq=1",/EXISTING_CHAIN_EVIDENCE_REFUSED/],
  ["wrong shape","ALTER TABLE public.audit_events ALTER COLUMN actor TYPE text",/AUDIT_SHAPE_REFUSED/],
  ["unsafe group","ALTER ROLE payrollph_audit_sealing INHERIT",/TRUSTED_NONLOGIN_GROUPS_REQUIRED/],
  ["missing group","DROP ROLE payrollph_audit_sealing",/TRUSTED_NONLOGIN_GROUPS_REQUIRED/],
 ]) await t.test("0133 atomically refuses "+name,()=>fixture(async()=>{
  await admin.query(setup);
  await assert.rejects(()=>admin.query(migration),error);
 }));
 await t.test("0133 preserves original row and enforces append-only and separate sealing identities",()=>fixture(async()=>{
  await admin.query(migration);
  // Execute the catalog fingerprint query against the numbered migration itself,
  // not only the independently maintained review-only companion fixture.
  const {STRICT_AUDIT_ROLE_PROOF_SQL}=await import("../../src/lib/audit-role-proof.ts");
  assert.equal((await admin.query(STRICT_AUDIT_ROLE_PROOF_SQL)).rows[0].auditFunctionBodiesTrusted,true);
  assert.deepEqual((await admin.query("SELECT actor,chain_seq,prev_hash,row_hash FROM public.audit_events WHERE id=1")).rows[0],
   {actor:"fictional-original",chain_seq:null,prev_hash:null,row_hash:null});
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_catalog.pg_trigger WHERE tgrelid='public.audit_events'::regclass AND NOT tgisinternal AND tgenabled='O'")).rows[0].n,3);
  await admin.query(`CREATE ROLE qa908_forward_app NOLOGIN NOINHERIT;
   CREATE ROLE qa908_forward_sealer NOLOGIN NOINHERIT;
   GRANT USAGE ON SCHEMA public TO qa908_forward_app,qa908_forward_sealer,payrollph_audit_sealing;
   GRANT SELECT ON public.audit_events TO qa908_forward_app,payrollph_audit_sealing;
   GRANT INSERT(organization_id,actor,action,resource,metadata,created_at) ON public.audit_events TO qa908_forward_app;
   GRANT USAGE ON public.audit_events_id_seq TO qa908_forward_app;
   GRANT UPDATE(chain_seq,prev_hash,row_hash) ON public.audit_events TO payrollph_audit_sealing;
   GRANT SELECT,INSERT,UPDATE ON public.audit_chain_heads TO payrollph_audit_sealing;
   GRANT payrollph_audit_sealing TO qa908_forward_sealer`);
  async function probe(identity,sql,denied=false,role="") {
   await admin.query("SAVEPOINT identity_probe");
   try {
    // Real session_user changes exercise the trigger's membership check too.
    await admin.query("SET LOCAL SESSION AUTHORIZATION "+identity);
    if(role)await admin.query("SET LOCAL ROLE "+role);
    if(denied) await assert.rejects(()=>admin.query(sql),e=>e.code==="42501");
    else return await admin.query(sql);
   } finally { await admin.query("ROLLBACK TO SAVEPOINT identity_probe"); }
  }
  const appended=await probe("qa908_forward_app","INSERT INTO public.audit_events(organization_id,actor,action,resource) VALUES(2,'fictional-append','test','test') RETURNING actor");
  assert.equal(appended.rows[0].actor,"fictional-append");
  for(const sql of [
   "UPDATE public.audit_events SET actor='tamper' WHERE id=1",
   "DELETE FROM public.audit_events WHERE id=1",
   "TRUNCATE public.audit_events",
   "INSERT INTO public.audit_events(organization_id,actor,action,resource,chain_seq) VALUES(1,'tamper','test','test',1)",
   "SELECT public.seal_audit_events(500)",
   "SELECT set_config('linaw.audit_maintenance','on',true); UPDATE public.audit_events SET actor='tamper' WHERE id=1",
  ]) await probe("qa908_forward_app",sql,true);
  // Even accidental broad DML grants cannot bypass the forward guards.
  await admin.query("GRANT UPDATE,DELETE,TRUNCATE ON public.audit_events TO qa908_forward_app");
  for(const sql of ["UPDATE public.audit_events SET actor='tamper' WHERE id=1","DELETE FROM public.audit_events WHERE id=1","TRUNCATE public.audit_events"])
   await probe("qa908_forward_app",sql,true);
  const sealed=await probe("qa908_forward_sealer","SELECT public.seal_audit_events(500) AS sealed",false,"payrollph_audit_sealing");
  assert.equal(sealed.rows[0].sealed,1);
  // The probe rollback leaves existing evidence unsealed and unchanged.
  assert.equal((await admin.query("SELECT chain_seq FROM public.audit_events WHERE id=1")).rows[0].chain_seq,null);
  await admin.query("SAVEPOINT replay");
  await assert.rejects(()=>admin.query(migration),/MISSING_OR_PARTIAL_STATE/);
  await admin.query("ROLLBACK TO SAVEPOINT replay");
 }));
}
