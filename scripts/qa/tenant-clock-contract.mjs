import assert from 'node:assert/strict';
export const METHODS=['POST web-bundy','POST web-bundy/consent','POST web-bundy/evidence','GET web-bundy/review','POST web-bundy/review'];
export const ACTIONS=['clock_in','break_start','break_end','clock_out'];
export function guard(env=process.env){
 assert.equal(env.TENANT_CLOCK_MODE,'fictional-disposable-only');assert.ok(!env.NODE_ENV,'runner NODE_ENV must be unset');
 const app=new URL(env.SECURITY_SMOKE_URL??'invalid:'),db=new URL(env.DATABASE_URL??'invalid:');
 assert.equal(app.protocol,'http:');assert.equal(app.hostname,'127.0.0.1');assert.equal(app.username+app.password+app.search+app.hash,'');
 assert.equal(db.protocol,'postgresql:');assert.equal(db.hostname,'127.0.0.1');assert.equal(db.username,'postgres');assert.equal(db.pathname,'/app_db');assert.equal(db.search+db.hash,'');
 for(const key of['WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED','PAYMONGO_DISBURSEMENTS_ENABLED','XENDIT_PAYOUTS_ENABLED','FINAL_PAY_MANUAL_RELEASE_ENABLED','MULTI_ENTITY_ENABLED','DOCUMENT_UPLOADS_ENABLED','WFM_GEOFENCE_ENABLED'])assert.notEqual(env[key],'true',key);
 for(const key of Object.keys(env))if(/^(XENDIT|PAYMONGO|RESEND|MAYA|STRIPE)_.*(SECRET(?:_KEY)?|API_KEY|TOKEN)$/.test(key))assert.ok(!env[key],key);
 assert.equal(env.WFM_PUNCH_EVIDENCE_ENABLED,'true');assert.equal(env.MALWARE_SCAN_URL??'','');assert.ok((env.PUNCH_DEVICE_HASH_KEY??'').length>=32);
}
export function verifyOwned(before,after,ctx,{table,id,fields,actor=ctx.owner.name,created=false}){
 const row=after[table].find(x=>x.id===id);assert.ok(row,'actual persisted row');assert.equal(row.organizationId,ctx.org.id);
 for(const[k,v]of Object.entries(fields))assert.deepEqual(row[k],v,k);
 if(created)assert.ok(!before[table].some(x=>x.id===id));else assert.notDeepEqual(before[table].find(x=>x.id===id),row,'actual own mutation');
 assert.ok(after.audit.some(x=>x.organizationId===ctx.org.id&&x.actor===actor&&!before.audit.some(y=>y.id===x.id)),'actual actor audit');
 assert.deepEqual(after.pay,before.pay);assert.deepEqual(after.runs,before.runs);assert.deepEqual(after.entries,before.entries);
}
export function discriminate(check,b,a,ctx,r){assert.throws(()=>check(b,a,ctx,r),undefined,"proof accepts another employer's data");}
