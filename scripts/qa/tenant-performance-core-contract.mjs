import assert from 'node:assert/strict';
export const METHODS=Object.freeze(['POST performance','PATCH performance','PATCH performance/calibration','PATCH performance/follow-through-governance']);
export const ACTIONS=Object.freeze({
 'POST performance':['cycle','template','cycle_template','goal-company','goal-team','goal-employee','review'],
 'PATCH performance':['goal','review_item','review-in-progress','review-completed','cycle'],
 'PATCH performance/calibration':['policy-create','policy-update','flag-accepted','flag-resolved','score','finalize'],
 'PATCH performance/follow-through-governance':['action_reminder_policy-create','action_reminder_policy-update','evidence_policy-create','evidence_policy-update','seal_cycle','verify_cycle','legal_hold-on','legal_hold-off','amend_seal'],
});
export function guard(env=process.env) {
 const app=new URL(env.SECURITY_SMOKE_URL??''),db=new URL(env.DATABASE_URL??'');
 assert.equal(env.TENANT_PERFORMANCE_CORE_MODE,'fictional-disposable-only');
 assert.equal(app.protocol,'http:');assert.equal(app.hostname,'127.0.0.1');
 assert.equal(db.protocol,'postgresql:');assert.equal(db.hostname,'127.0.0.1');
 assert.equal(db.pathname,'/app_db');assert.equal(db.search+db.hash,'');
 assert.equal(db.username,'postgres');assert.equal(env.NODE_ENV,undefined,'runner must unset NODE_ENV');
 for(const key of ['PAYMONGO_SECRET_KEY','XENDIT_SECRET_KEY','RESEND_API_KEY','SMTP_URL'])assert.equal(Boolean(env[key]),false,key);
 for(const key of ['PAYMONGO_DISBURSEMENTS_ENABLED','XENDIT_PAYOUTS_ENABLED','WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED'])assert.notEqual(env[key],'true',key);
}
export function verifyOwnChange(before,after,actor,claim) {
 const rows=after[claim.table],old=before[claim.table];assert.ok(Array.isArray(rows)&&Array.isArray(old));
 const row=rows.find(r=>r.id===claim.id);assert.ok(row,'persisted own target');
 assert.equal(row.organizationId,actor.org.id,'actual own employer identity');
 for(const [key,value] of Object.entries(claim.fields))assert.deepEqual(row[key],value,'persisted '+key);
 if(claim.created){assert.equal(rows.length,old.length+1);assert.ok(!old.some(r=>r.id===claim.id));}
 else if(!claim.readOnly)assert.notDeepEqual(row,old.find(r=>r.id===claim.id),'non-noop own mutation');
 const added=after.auditEvents.filter(r=>!before.auditEvents.some(o=>o.id===r.id));
 assert.equal(added.length,1,'one audit per successful action');
 assert.equal(added[0].organizationId,actor.org.id);assert.equal(added[0].actor,actor.owner.name);
 assert.ok(added[0].action.startsWith('Performance')||added[0].action==='Structured performance item scored');
 assert.deepEqual(after.payrollRuns,before.payrollRuns,'no payroll effects');
 assert.deepEqual(after.employeePayProfiles,before.employeePayProfiles,'no pay-profile effects');
 return row;
}
export function rejectOtherEmployer(verify,sample,actor) {
 assert.throws(()=>verify(sample.before,sample.after,actor,sample.claim),
   'proof accepts another employer\'s data');
}
