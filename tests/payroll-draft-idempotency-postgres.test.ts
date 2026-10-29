import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
const enabled = process.env.PAYROLL_DRAFT_IDEMPOTENCY_PROOF_MODE === "disposable-only";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol,"postgresql:"); assert.equal(url.hostname,"127.0.0.1");
  assert.equal(url.port,"5432"); assert.equal(url.username,"postgres"); assert.equal(url.search+url.hash,"");
  assert.ok(/^\/payroll_intent_\d{8}_[a-f0-9]{8}$/.test(url.pathname)
    || (url.pathname==="/app_db" && process.env.CI==="true" && process.env.GITHUB_ACTIONS==="true"));
  for(const key of ["PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY","RESEND_API_KEY","SMTP_URL"]) assert.equal(Boolean(process.env[key]),false,key);
  for(const key of ["PAYMONGO_DISBURSEMENTS_ENABLED","XENDIT_PAYOUTS_ENABLED","WORKER_ENABLED","CENTRAL_SCHEDULER_ENABLED"]) assert.notEqual(process.env[key],"true",key);
}
test("PG route: concurrent draft keys, lost response, rollback, caller/employer isolation and no replay calculation",{skip:!enabled,timeout:120000},async()=>{
  const require = createRequire(import.meta.url);
  const authPath = require.resolve("../src/lib/auth"); const auth = require(authPath);
  let identity: unknown = null;
  require.cache[authPath]!.exports={...auth,getSessionUser:async()=>identity};
  const {db,pool}=await import("../src/db");
  const s=await import("../src/db/schema"); const {eq,and,inArray}=await import("drizzle-orm");
  const create=require("../src/app/api/payroll-runs/route.ts").POST;
  const suffix=randomUUID().replaceAll("-","").slice(0,8);
  const prior={APP_BASE_URL:process.env.APP_BASE_URL,PUBLIC_SIGNUP_MODE:process.env.PUBLIC_SIGNUP_MODE};
  process.env.APP_BASE_URL="http://127.0.0.1:3011"; process.env.PUBLIC_SIGNUP_MODE="disabled";
  const employers=[];
  try {
    for(let n=0;n<3;n++) {
      const [org]=await db.insert(s.organizations).values({name:`Fictional intent ${suffix}-${n}`,legalName:"Fictional only"}).returning();
      const [entity]=await db.insert(s.legalEntities).values({organizationId:org.id,code:"PRIMARY",legalName:"Fictional only",displayName:"Fictional",primaryEntity:true}).returning();
      const [user]=await db.insert(s.users).values({email:`intent-${suffix}-${n}@example.invalid`,name:"Fictional owner "+n,role:"owner",passwordHash:"not-a-login"}).returning();
      await db.insert(s.userOrganizations).values({organizationId:org.id,userId:user.id,role:"owner",active:true});
      await db.insert(s.employees).values({organizationId:org.id,legalEntityId:entity.id,employeeNo:"FICTIONAL-"+n,
        firstName:"Fictional",lastName:"Intent",title:"QA only",avatarInitials:"QA",basicRate:"30000",startDate:"2025-01-01"});
      employers.push({org,entity,user});
    }
    const [a,b,victim]=employers;
    const key="fictional-intent-"+suffix;
    const body=(actor: typeof a)=>({organizationId:actor.org.id,legalEntityId:actor.entity.id,periodStart:"2026-10-01",periodEnd:"2026-10-15",payDate:"2026-10-15",processNow:false});
    const post=(payload:unknown,intentKey: string | null=key)=>create(new Request("http://127.0.0.1:3011/api/payroll-runs",{
      method:"POST",headers:{origin:"http://127.0.0.1:3011","content-type":"application/json",...(intentKey?{"Idempotency-Key":intentKey}:{})},body:JSON.stringify(payload),
    }));
    const snapshot=async(orgId:number)=>({
      runs:await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId,orgId)),
      keys:await db.select().from(s.idempotencyKeys).where(eq(s.idempotencyKeys.organizationId,orgId)),
      audit:await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId,orgId)),
      jobs:await db.select().from(s.payrollJobs).where(eq(s.payrollJobs.organizationId,orgId)),
      entries:await db.select().from(s.payrollEntries).where(inArray(s.payrollEntries.payrollRunId,db.select({id:s.payrollRuns.id}).from(s.payrollRuns).where(eq(s.payrollRuns.organizationId,orgId)))),
    });
    identity=victim.user;
    const victimPositive=await post(body(victim)); assert.equal(victimPositive.status,201);
    const victimBefore=await snapshot(victim.org.id);
    for(const attacker of [a,b]) {
      identity=attacker.user;
      assert.equal((await post(body(victim))).status,403);
      assert.equal((await post({...body(attacker),legalEntityId:victim.entity.id})).status,422);
      assert.deepEqual(await snapshot(victim.org.id),victimBefore);
      const responses=await Promise.all([post(body(attacker)),post(body(attacker))]);
      assert.deepEqual(responses.map((r:Response)=>r.status).sort(),[200,201]);
      const payloads=await Promise.all(responses.map((r:Response)=>r.json()));
      assert.equal(payloads[0].run.id,payloads[1].run.id);
      const saved=await snapshot(attacker.org.id);
      assert.equal(saved.runs.length,1); assert.equal(saved.keys.length,1); assert.equal(saved.jobs.length,0);
      assert.equal(saved.audit.filter(e=>e.action==="Payroll draft created").length,1);
      const retry=await post(body(attacker)); assert.equal(retry.status,200);
      assert.equal((await retry.json()).run.id,saved.runs[0].id);
      assert.deepEqual(await snapshot(attacker.org.id),saved,"Lost-response replay creates no run, audit or job");
      const mismatch=await post({...body(attacker),payDate:"2026-10-16"}); assert.equal(mismatch.status,409);
      assert.equal((await mismatch.json()).code,"PAYROLL_DRAFT_KEY_CONFLICT");
      assert.deepEqual(await snapshot(attacker.org.id),saved);
      assert.deepEqual(await snapshot(victim.org.id),victimBefore);
    }
    identity=a.user;
    // Different keys race through the fast-path read; the transactional overlap check must serialize them too.
    const next={...body(a),periodStart:"2026-10-16",periodEnd:"2026-10-31",payDate:"2026-10-31"};
    const raced=await Promise.all([post(next,key+"-new-a"),post(next,key+"-new-b")]);
    assert.deepEqual(raced.map((r:Response)=>r.status).sort(),[201,409]);
    // Veto the actual draft audit: run, receipt and audit all roll back, then the same key is reusable.
    const trigger="qa_intent_veto_"+suffix;
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.organization_id = ${a.org.id} AND NEW.action = 'Payroll draft created' THEN RAISE EXCEPTION 'FICTIONAL_INTENT_VETO'; END IF; RETURN NEW; END $$`);
    const later={...body(a),periodStart:"2026-11-01",periodEnd:"2026-11-15",payDate:"2026-11-15"};
    const before=await snapshot(a.org.id);
    try {
      await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
      await assert.rejects(post(later,key+"-rollback"));
      assert.deepEqual(await snapshot(a.org.id),before);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_events`); await pool.query(`DROP FUNCTION ${trigger}()`);
    }
    assert.equal((await post(later,key+"-rollback")).status,201);
    // Simulate a committed create whose process-now response/queue handoff was lost.
    const {createPayrollDraftOnce}=await import("../src/lib/payroll-draft-creation");
    const stranded={...body(a),scopeOrgUnitId:null,periodStart:"2026-11-16",periodEnd:"2026-11-30",payDate:"2026-11-30",processNow:true};
    const committed=await createPayrollDraftOnce(stranded,a.user.id,key+"-stranded",async tx=>{
      const [run]=await tx.insert(s.payrollRuns).values({organizationId:a.org.id,legalEntityId:a.entity.id,
        periodLabel:"Fictional interrupted creation",periodStart:stranded.periodStart,periodEnd:stranded.periodEnd,payDate:stranded.payDate,status:"Draft"}).returning();
      return run;
    });
    const strandedBefore=await snapshot(a.org.id);
    const recovered=await post(stranded,key+"-stranded"); assert.equal(recovered.status,200);
    const recovery=await recovered.json(); assert.equal(recovery.run.id,committed.run.id);
    assert.equal(recovery.recoveryRequired,true);
    assert.deepEqual(await snapshot(a.org.id),strandedBefore,"Replay must not implicitly calculate the stranded draft");
    identity=null; assert.equal((await post(body(a))).status,401);
    assert.deepEqual(await snapshot(victim.org.id),victimBefore);
    // Receipt namespaces include the actor even inside one employer; a different key cannot bypass period overlap.
    const [other]=await db.insert(s.users).values({email:`intent-peer-${suffix}@example.invalid`,name:"Fictional peer",role:"owner",passwordHash:"not-a-login"}).returning();
    await db.insert(s.userOrganizations).values({organizationId:a.org.id,userId:other.id,role:"owner",active:true});
    identity=other; assert.equal((await post(body(a))).status,409);
    identity=a.user;
    await db.update(s.userOrganizations).set({active:false}).where(and(eq(s.userOrganizations.userId,a.user.id),eq(s.userOrganizations.organizationId,a.org.id)));
    assert.equal((await post(body(a))).status,403,"A saved receipt never bypasses revoked membership");
  } finally {
    require.cache[authPath]!.exports=auth;
    for(const [name,value] of Object.entries(prior)) {if(value===undefined)delete process.env[name];else process.env[name]=value;}
    await pool.end();
  }
});
