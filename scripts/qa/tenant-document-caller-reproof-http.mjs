/** Refresh unchanged HMO/HR-queue domain assertions after the document caller
 * fixture changes. Disposable PG16, real localhost HTTP, zero credits. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {requireDisposableApprovalTask} from './tenant-approval-task-contract.mjs';
requireDisposableApprovalTask();
for(const flag of ['FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED',
 'PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED','XENDIT_BILLING_ENABLED',
 'XENDIT_PAYOUTS_ENABLED','PAYMONGO_DISBURSEMENTS_ENABLED'])assert.equal(process.env[flag],'false',flag+' must remain OFF');
const [{db,pool},s,{eq},fixture,hmo,queue]=await Promise.all([
 import('../../src/db/index.ts'),import('../../src/db/schema.ts'),import('drizzle-orm'),
 import('./tenant-table-http.mjs'),import('./tenant-hmo-http.mjs'),import('./hcm-work-queue-http.mjs')]);
async function makeSession(id){const session=await fixture.standaloneMakeSession(id);
 await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,session.id));return session;}
async function request(path,{method='GET',cookie,body,headers={}}={}){
 assert.ok(path.startsWith('/')&&!path.startsWith('//'),'local path only');
 const response=await fetch('http://127.0.0.1:3000'+path,{method,redirect:'manual',signal:AbortSignal.timeout(30000),
  headers:{Origin:'http://127.0.0.1:3000','Sec-Fetch-Site':'same-origin','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},
  body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let json;try{json=JSON.parse(text);}catch{json=null;}
 return {status:response.status,text,json,headers:response.headers};
}
const expectStatus=(response,status,label)=>{assert.equal(response.status,status,label+': '+response.text.slice(0,200));return response;};
try{
 assert.equal((await db.select().from(s.organizations).limit(1)).length,0,'empty fictional database required');
 const nonce=randomUUID().slice(0,8);
 const a=await fixture.seedEmployer('ATTA',nonce,makeSession),b=await fixture.seedEmployer('ATTB',nonce,makeSession);
 for(let i=0;i<7;i++)await fixture.seedEmployer('FILL',nonce+i,makeSession);
 const victim=await fixture.seedEmployer('VICTIM',nonce,makeSession);
 assert.ok(victim.org.id>Math.max(a.org.id,b.org.id,6));
 const actors=[victim,a,b];
 const f={orgs:actors.map(e=>e.org),owners:actors.map(e=>e.owner),entities:actors.map(e=>e.entity),
  ownerSessions:actors.map(e=>({cookie:e.cookie})),victimEmployee:victim.worker,ownedEmployees:[a.worker,b.worker]};
 // Reuse the complete existing assertions, including all four HMO writes,
 // forged targets, role checks, actual SQL snapshots and the client-shell limit.
 await queue.verifyHcmWorkQueueIsolation(f,{request,expectStatus});
 // The queue verifier invokes the complete page-boundary proof itself.
 await hmo.verifyHmoIsolation(f,{request,expectStatus,makeSession});
 console.log(JSON.stringify({kind:'DOCUMENT_CALLER_REPROOF',label:'SOLO_VERIFIED_DEV_RECOVERY',
  result:'PASS',employers:3,attackers:2,credits:0,productionCertified:false,providerCalls:0}));
}finally{await pool.end();}
