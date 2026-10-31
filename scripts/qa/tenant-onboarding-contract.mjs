import assert from 'node:assert/strict';
export const METHODS=['POST employees/import','POST employees','PATCH employees','POST recruitment/hire'];
export function guard(env=process.env){
 const app=new URL(env.SECURITY_SMOKE_URL??'invalid:'),db=new URL(env.DATABASE_URL??'invalid:');
 assert.equal(env.TENANT_ONBOARDING_MODE,'fictional-disposable-only');
 assert.equal(app.protocol,'http:');assert.equal(app.hostname,'127.0.0.1');assert.equal(app.search+app.hash,'');
 assert.equal(db.protocol,'postgresql:');assert.equal(db.hostname,'127.0.0.1');assert.equal(db.username,'postgres');assert.equal(db.pathname,'/app_db');assert.equal(db.search+db.hash,'');
 assert.ok(['legacy','preview'].includes(env.TENANT_ONBOARDING_PROFILE));
 assert.equal(env.EMPLOYEE_IMPORT_PREVIEW_ENABLED,env.TENANT_ONBOARDING_PROFILE==='preview'?'true':'false');
 assert.ok(!env.NODE_ENV,'runner must not pretend to be a production worker');
 for(const key of ['PAYMONGO_DISBURSEMENTS_ENABLED','XENDIT_PAYOUTS_ENABLED','FINAL_PAY_MANUAL_RELEASE_ENABLED','WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED','MULTI_ENTITY_ENABLED'])assert.notEqual(env[key],'true',key);
 for(const key of Object.keys(env))if(/^(PAYMONGO|XENDIT|RESEND|MAYA|STRIPE)_.*(SECRET(?:_KEY)?|API_KEY|TOKEN)$/.test(key))assert.ok(!env[key],key);
}
export function verifyOwned(before,after,ctx,{table,id,fields,audit=true,created=false}){
 const row=after[table].find(r=>r.id===id);assert.ok(row,'persisted own row required');assert.equal(row.organizationId,ctx.org.id);
 for(const[key,value]of Object.entries(fields))assert.deepEqual(row[key],value,key);
 if(created)assert.ok(!before[table].some(r=>r.id===id),'must actually insert');
 else assert.notDeepEqual(before[table].find(r=>r.id===id),row,'must actually change');
 if(audit)assert.ok(after.audit.some(r=>r.organizationId===ctx.org.id&&r.actor===ctx.owner.name&&!before.audit.some(b=>b.id===r.id)),'new signed-in actor audit required');
 assert.deepEqual(after.runs,before.runs,'no payroll runs changed');assert.deepEqual(after.entries,before.entries,'no payroll entries changed');
}
export function rejectAnother(check,before,after,foreignCtx,response){assert.throws(()=>check(before,after,foreignCtx,response),undefined,"proof accepts another employer's data");}
