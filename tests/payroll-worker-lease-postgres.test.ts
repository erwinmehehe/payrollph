import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import test from "node:test";

const enabled=process.env.PAYROLL_WORKER_RECOVERY_PROOF_MODE==="disposable-only";
if(enabled) {
  const url=new URL(process.env.DATABASE_URL??"");
  assert.equal(url.protocol,"postgresql:"); assert.equal(url.hostname,"127.0.0.1");
  assert.equal(url.port,"5432"); assert.equal(url.username,"postgres");assert.equal(url.search+url.hash,"");
  assert.ok(/^\/payroll_worker_\d{8}_[a-f0-9]{8}$/.test(url.pathname)
    || (url.pathname==="/app_db"&&process.env.CI==="true"&&process.env.GITHUB_ACTIONS==="true"));
  for(const key of ["PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY","RESEND_API_KEY","SMTP_URL"])assert.equal(Boolean(process.env[key]),false,key);
  for(const key of ["WORKER_ENABLED","CENTRAL_SCHEDULER_ENABLED","PAYMONGO_DISBURSEMENTS_ENABLED","XENDIT_PAYOUTS_ENABLED"])assert.notEqual(process.env[key],"true",key);
}
test("PG: dead-worker lease recovery fences the old worker, preserves chunks and audits claims atomically",{skip:!enabled,timeout:120000},async()=>{
  const {db,pool}=await import("../src/db");const s=await import("../src/db/schema");
  const {eq,and,inArray}=await import("drizzle-orm");
  const {enqueuePayrollRun,processNextPayrollJob,PAYROLL_JOB_LEASE_SECONDS}=await import("../src/lib/payroll-engine");
  const suffix=randomUUID().replaceAll("-","").slice(0,8);
  const [org,victim]=await db.insert(s.organizations).values([
    {name:"Fictional lease "+suffix,legalName:"Fictional lease"},
    {name:"Fictional untouched "+suffix,legalName:"Fictional untouched"},
  ]).returning();
  const trigger="qa_lease_veto_"+suffix;
  const waitFor=async(check:()=>Promise<boolean>,label:string)=>{
    for(let i=0;i<300;i++){if(await check())return;await pause(10);}
    assert.fail("Database barrier not reached: "+label);
  };
  try {
    for(const employer of [org,victim])for(let n=0;n<2;n++) {
      const [employee]=await db.insert(s.employees).values({organizationId:employer.id,employeeNo:"LEASE-"+n,
        firstName:"Fictional",lastName:"Lease",title:"QA only",avatarInitials:"QA",basicRate:"30000",startDate:"2025-01-01",restDay:"Sunday"}).returning();
      await db.insert(s.employeePayProfiles).values({organizationId:employer.id,employeeId:employee.id,payBasis:"monthly",rateAmount:"30000",standardWorkDaysPerMonth:"22",standardHoursPerDay:"8"});
    }
    const newRun=async()=>{
      const [run]=await db.insert(s.payrollRuns).values({organizationId:org.id,periodLabel:"Fictional lease",periodStart:"2026-10-01",periodEnd:"2026-10-15",payDate:"2026-10-15",status:"Draft"}).returning();
      await enqueuePayrollRun(run.id,1);return run;
    };
    const snapshot=async(organizationId:number)=>({
      runs:await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId,organizationId)),
      jobs:await db.select().from(s.payrollJobs).where(eq(s.payrollJobs.organizationId,organizationId)),
      entries:await db.select().from(s.payrollEntries).where(inArray(s.payrollEntries.payrollRunId,db.select({id:s.payrollRuns.id}).from(s.payrollRuns).where(eq(s.payrollRuns.organizationId,organizationId)))),
      audit:await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId,organizationId)),
    });
    const jobFor=async(runId:number)=>(await db.select().from(s.payrollJobs).where(eq(s.payrollJobs.payrollRunId,runId)))[0];
    const expire=async(runId:number)=>db.update(s.payrollJobs).set({lockedAt:new Date(Date.now()-(PAYROLL_JOB_LEASE_SECONDS+60)*1000)}).where(eq(s.payrollJobs.payrollRunId,runId));
    const victimBefore=await snapshot(victim.id);
    const run=await newRun();
    // Complete the first chunk, then model a process killed after claiming chunk 2.
    assert.equal((await processNextPayrollJob("fictional-first-chunk",run.id)).processed,true);
    const firstEntries=await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId,run.id));
    assert.equal(firstEntries.length,1);
    await db.update(s.payrollJobs).set({status:"processing",lockedAt:new Date(),lockedBy:"fictional-killed",attempts:2}).where(eq(s.payrollJobs.payrollRunId,run.id));
    const fresh=await snapshot(org.id);
    assert.equal((await processNextPayrollJob("must-not-steal-fresh",run.id)).processed,false);
    assert.deepEqual(await snapshot(org.id),fresh,"Fresh leases cannot be stolen");
    await expire(run.id);
    const dead=await snapshot(org.id);
    // Recovery audit veto must not consume the attempt or clear the old lease.
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.organization_id = ${org.id} AND NEW.action = 'Payroll worker lease recovered' THEN RAISE EXCEPTION 'FICTIONAL_LEASE_VETO'; END IF; RETURN NEW; END $$`);
    try {
      await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
      await assert.rejects(processNextPayrollJob("fictional-vetoed-recovery",run.id),/FICTIONAL_LEASE_VETO/);
      assert.deepEqual(await snapshot(org.id),dead);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_events`);await pool.query(`DROP FUNCTION ${trigger}()`);
    }
    assert.equal((await processNextPayrollJob("fictional-recovery",run.id)).processed,true);
    const recovered=await jobFor(run.id);assert.equal(recovered.status,"completed");assert.equal(recovered.attempts,3);
    const entries=await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId,run.id));
    assert.equal(entries.length,2);assert.deepEqual(entries.find(e=>e.id===firstEntries[0].id),firstEntries[0],"A committed earlier chunk is not recalculated");
    const [savedRun]=await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id,run.id));
    assert.equal(savedRun.status,"Needs review");assert.equal(savedRun.processedChunks,2);assert.equal(Number(savedRun.grossPay),30000);
    assert.equal((await processNextPayrollJob("completed-retry",run.id)).processed,false);

    // An actual old worker waits at the final run-row lock while another claims its expired lease.
    const racing=await newRun();const blocker=await pool.connect();
    let oldWork:Promise<{ok:boolean;error?:unknown}>|undefined,newWork:Promise<{ok:boolean;error?:unknown}>|undefined;
    try {
      await blocker.query("BEGIN");await blocker.query("SELECT id FROM payroll_runs WHERE id=$1 FOR UPDATE",[racing.id]);
      oldWork=processNextPayrollJob("fictional-old-worker",racing.id).then(()=>({ok:true}),error=>({ok:false,error}));
      await waitFor(async()=> (await jobFor(racing.id)).attempts===1,"old worker claimed");
      await waitFor(async()=>Number((await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM payroll_runs%FOR UPDATE%'")).rows[0].count)>0,"old worker waiting on run row");
      await expire(racing.id);
      newWork=processNextPayrollJob("fictional-replacement",racing.id).then(()=>({ok:true}),error=>({ok:false,error}));
      await waitFor(async()=> (await jobFor(racing.id)).attempts===2,"replacement claimed expired job");
      await blocker.query("COMMIT");
      const oldResult=await oldWork,newResult=await newWork;
      assert.equal(oldResult.ok,false,"Original worker must lose its write fence");
      assert.match(String(oldResult.error),/PAYROLL_HISTORY_JOB_CLAIM_LOST/);
      assert.equal(newResult.ok,true,String(newResult.error));
      const job=await jobFor(racing.id);assert.equal(job.status,"queued");assert.equal(job.chunkIndex,1);assert.equal(job.attempts,2);
      assert.equal((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id,racing.id)))[0].status,"Processing","Old error handler cannot fail its replacement");
      await processNextPayrollJob("fictional-final-chunk",racing.id);
      const racedEntries=await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId,racing.id));
      assert.equal(racedEntries.length,2);assert.equal(new Set(racedEntries.map(e=>e.employeeId)).size,2);
      assert.equal((await jobFor(racing.id)).status,"completed");
      const events=await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.organizationId,org.id),eq(s.auditEvents.action,"Payroll calculation completed")));
      assert.equal(events.filter(e=>(e.metadata as {runId?:number}).runId===racing.id).length,1);
    } finally {
      await blocker.query("ROLLBACK");blocker.release();
      await Promise.allSettled([oldWork,newWork].filter((p):p is Promise<{ok:boolean;error?:unknown}>=>p!==undefined));
    }
    // An expired job never grants permission to rewrite released financial evidence.
    await db.update(s.payrollRuns).set({status:"Released"}).where(eq(s.payrollRuns.id,run.id));
    const financialBefore={run:(await snapshot(org.id)).runs.find(r=>r.id===run.id),entries};
    await db.update(s.payrollJobs).set({status:"processing",lockedBy:"fictional-dead-released"}).where(eq(s.payrollJobs.payrollRunId,run.id));
    await expire(run.id);
    await assert.rejects(processNextPayrollJob("immutable-recovery-refused",run.id));
    assert.deepEqual((await snapshot(org.id)).runs.find(r=>r.id===run.id),financialBefore.run);
    assert.deepEqual(await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId,run.id)),financialBefore.entries);
    assert.deepEqual(await snapshot(victim.id),victimBefore);
  } finally {await pool.end();}
});
