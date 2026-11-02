import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {requireFictionalJourney} from './first-payroll-full-contract.mjs';

// Explicit loopback/provider-off guard before importing the application pool.
const {database}=requireFictionalJourney();
const {db,pool}=await import('../../src/db/index.ts');
const s=await import('../../src/db/schema.ts');
const {eq,asc}=await import('drizzle-orm');
const {seedEmployer,addWorker,standaloneMakeSession,standaloneRequest,standaloneExpectStatus}=await import('./tenant-table-http.mjs');
const identity=(await pool.query("select current_setting('server_version_num')::int as version,current_setting('data_directory') as directory")).rows[0];
assert.equal(Math.floor(identity.version/10000),16);
assert.ok((process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'&&database.port==='5432')||identity.directory.replaceAll('\\','/').endsWith('payrollph-first-payroll-complete-20261031/outputs/pg16'),'disposable task-owned cluster only');
const nonce=randomUUID().replaceAll('-','').slice(0,10);
const plain=v=>JSON.parse(JSON.stringify(v));
const path='/api/earned-wage';
async function snapshot(e){return plain({requests:await db.select().from(s.earnedWageRequests).where(eq(s.earnedWageRequests.organizationId,e.org.id)).orderBy(asc(s.earnedWageRequests.id)),audit:await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId,e.org.id)).orderBy(asc(s.auditEvents.id))});}
async function send(e,body,status){return standaloneExpectStatus(await standaloneRequest(path,{cookie:e.cookie,method:'POST',body}),status,path).json;}
const body=(e,worker=e.worker)=>({organizationId:e.org.id,employeeId:worker.id,requestedAmount:100});
let triggerCreated=false;
try{
 const employers=[];
 for(const label of ['ATTA','ATTB','VICTIM'])employers.push(await seedEmployer(label,nonce,standaloneMakeSession));
 const [a,b,victim]=employers;
 const workDate=new Date().toISOString().slice(0,10);
 async function punch(e,worker){await db.insert(s.timePunches).values({organizationId:e.org.id,employeeId:worker.id,workDate,timeIn:new Date(workDate+'T01:00:00Z'),timeOut:new Date(workDate+'T10:00:00Z'),source:'fictional-ewa-post'});}
 for(const e of employers)await punch(e,e.worker);
 assert.ok(victim.worker.id>b.worker.id&&b.worker.id>a.worker.id);
 const victimBefore=await snapshot(victim);
 for(const e of [a,b]){
  const before=await snapshot(e);
  const own=await send(e,body(e),201);
  assert.equal(own.request.organizationId,e.org.id);assert.equal(own.request.employeeId,e.worker.id);
  const after=await snapshot(e);
  assert.equal(after.requests.length,before.requests.length+1);
  assert.equal(after.requests.at(-1).id,own.request.id);
  assert.equal(after.audit.length,before.audit.length+1);
  assert.equal(after.audit.at(-1).metadata.requestId,own.request.id);
  await send(e,body(victim),403);
  await send(e,{...body(e),employeeId:victim.worker.id},404);
  assert.deepEqual(await snapshot(e),after,'foreign/forged writes leave attacker state unchanged');
  assert.deepEqual(await snapshot(victim),victimBefore,'victim requests and audit unchanged');
 }
 // Hold the same employee lock in a third connection, queue both real HTTP
 // requests, then release it. A mere sequential duplicate check cannot pass.
 const concurrent=await addWorker(a,'CONCURRENT');await punch(a,concurrent);
 const blocker=await pool.connect();
 const beforeConcurrent=await snapshot(a);
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM employees WHERE id=$1 FOR UPDATE',[concurrent.id]);
  const calls=[1,2].map(()=>standaloneRequest(path,{cookie:a.cookie,method:'POST',body:body(a,concurrent)}));
  let queued=0;
  for(let attempt=0;attempt<100;attempt++){
   await blocker.query('SELECT pg_stat_clear_snapshot()');
   queued=Number((await blocker.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%employees%' AND pid<>pg_backend_pid()")).rows[0].count);
   if(queued>=2)break;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.ok(queued>=2,'both real HTTP requests must contend on the employee lock');
  await blocker.query('COMMIT');
  const responses=await Promise.all(calls);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,422]);
 }finally{await blocker.query('ROLLBACK');blocker.release();}
 const afterConcurrent=await snapshot(a);
 assert.equal(afterConcurrent.requests.length,beforeConcurrent.requests.length+1);
 assert.equal(afterConcurrent.audit.length,beforeConcurrent.audit.length+1);
 assert.equal(afterConcurrent.requests.filter(r=>r.employeeId===concurrent.id&&r.status==='pending').length,1);
 const rollbackWorker=await addWorker(b,'ROLLBACK');await punch(b,rollbackWorker);
 const beforeFailure=await snapshot(b);
 // Fault injection exists only in this guarded disposable DB. No production
 // route switches or app-side audit bypasses are introduced.
 await pool.query(`CREATE FUNCTION qa_ewa_audit_failure_${nonce}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id = ${b.org.id} AND NEW.action = 'Earned wage advance requested' THEN RAISE EXCEPTION 'fictional EWA audit failure'; END IF; RETURN NEW; END $$`);
 await pool.query(`CREATE TRIGGER qa_ewa_audit_failure_${nonce} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_ewa_audit_failure_${nonce}()`);triggerCreated=true;
 await send(b,body(b,rollbackWorker),409);
 assert.deepEqual(await snapshot(b),beforeFailure,'audit insertion failure rolls back request and audit');
 await pool.query(`DROP TRIGGER qa_ewa_audit_failure_${nonce} ON audit_events`);triggerCreated=false;
 await pool.query(`DROP FUNCTION qa_ewa_audit_failure_${nonce}()`);
 await send(b,body(b,rollbackWorker),201);
 assert.deepEqual(await snapshot(victim),victimBefore);
 mkdirSync('outputs',{recursive:true});writeFileSync('outputs/tenant-earned-wage-post.json',JSON.stringify({result:'PASS',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),twoAttackers:true,foreignDenied:true,forgedDenied:true,unchangedVictim:true,concurrentPendingRequests:1,auditFailureRollback:true,retryAfterFaultRemoval:true,providerCalls:0,coverageCredits:0},null,2));
 console.log('PASS earned-wage POST two-attacker HTTP, concurrent duplicate refusal and audit rollback');
}finally{
 if(triggerCreated)await pool.query(`DROP TRIGGER IF EXISTS qa_ewa_audit_failure_${nonce} ON audit_events`);
 await pool.query(`DROP FUNCTION IF EXISTS qa_ewa_audit_failure_${nonce}()`);
 await pool.end();
}
