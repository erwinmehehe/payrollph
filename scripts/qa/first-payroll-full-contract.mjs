import assert from 'node:assert/strict';
export function requireFictionalJourney(env=process.env){
 const database=new URL(env.DATABASE_URL??'invalid:'),base=new URL(env.SECURITY_SMOKE_URL??'invalid:');
 assert.equal(env.FIRST_PAYROLL_FULL_MODE,'fictional-disposable-only');
 assert.equal(database.protocol,'postgresql:');assert.equal(database.hostname,'127.0.0.1');assert.equal(database.pathname,'/app_db');
 assert.equal(database.username,'postgres');assert.equal(database.search+database.hash,'');
 assert.equal(base.protocol,'http:');assert.equal(base.hostname,'127.0.0.1');assert.equal(base.search+base.hash,'');
 for(const k of ['WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED','PAYMONGO_DISBURSEMENTS_ENABLED','XENDIT_PAYOUTS_ENABLED'])assert.equal(env[k],'false',k);
 for(const k of ['PAYMONGO_SECRET_KEY','XENDIT_SECRET_KEY','RESEND_API_KEY','POSTMARK_SERVER_TOKEN','SMTP_URL','MALWARE_SCAN_URL'])assert.ok(!env[k],k);
 return{database,base};
}
export function centavos(value){
 assert.match(String(value),/^-?\d+(?:\.\d{1,2})?$/);
 const text=String(value),[whole,fraction='']=text.replace('-','').split('.');
 const result=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*(text.startsWith('-')?-1:1);
 assert.ok(Number.isSafeInteger(result));return result;
}
export function reconcileFirstPayroll(run,entries){
 assert.ok(entries.length>0);assert.equal(entries.length,run.employeeCount);
 assert.equal(new Set(entries.map(e=>e.employeeId)).size,entries.length);
 let gross=0,net=0;
 for(const entry of entries){
  assert.equal(entry.payrollRunId,run.id);
  assert.equal(centavos(entry.grossPay)-centavos(entry.deductions),centavos(entry.netPay));
  gross+=centavos(entry.grossPay);net+=centavos(entry.netPay);
 }
 assert.equal(centavos(run.grossPay),gross);assert.equal(centavos(run.netPay),net);assert.ok(net>0);
}
