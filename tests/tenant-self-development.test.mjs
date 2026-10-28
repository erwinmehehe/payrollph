import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyReceipt, verifyCredits, RECEIPT } from '../scripts/qa/tenant-self-development-credit.mjs';
import { ENDPOINT, METHODS, requireDisposable, proveRead, proveProgress, proveMilestone } from '../scripts/qa/tenant-self-development-contract.mjs';
const actor={org:{id:11},worker:{id:21},ess:{id:31,name:'Fictional worker'},marker:'FICTIONAL-A',open:{id:41,title:'FICTIONAL-A open'},milestone:{id:51}};
const before=()=>({plans:[{id:41,organizationId:11,employeeId:21,skillId:61,title:'FICTIONAL-A open',employeeVisible:true,targetDate:'2099-12-01'},
 {id:42,organizationId:11,employeeId:21,skillId:61,title:'FICTIONAL-A completed',employeeVisible:true,targetDate:'2099-12-02'},
 {id:43,organizationId:11,employeeId:21,skillId:61,title:'FICTIONAL-A cancelled',employeeVisible:true,targetDate:'2099-12-03'},
 {id:44,organizationId:11,employeeId:21,skillId:61,title:'FICTIONAL-A private',employeeVisible:false,targetDate:'2099-12-04'}],
 skills:[{id:61,name:'FICTIONAL-A skill'}],milestones:[{id:51,organizationId:11,planId:41,title:'Fictional milestone',dueDate:'2099-12-01',status:'open',completedAt:null,completedByUserId:null,completedByName:null}],progress:[],audits:[],payroll:[]});
test('three exact independent self-development methods',()=>{
 assert.equal(ENDPOINT,'/api/self/performance/development-plans');assert.equal(METHODS.length,3);
});
test('environment guard refuses hosted targets, missing local opt-in, live providers and workers',()=>{
 const env={TENANT_SELF_DEVELOPMENT_MODE:'fictional-disposable-only',SECURITY_SMOKE_URL:'http://127.0.0.1:3000',DATABASE_URL:'postgresql://postgres:fictional@127.0.0.1:5432/app_db',NODE_ENV:'production',WORKER_ENABLED:'false',CENTRAL_SCHEDULER_ENABLED:'false',PAYMONGO_DISBURSEMENTS_ENABLED:'false',XENDIT_PAYOUTS_ENABLED:'false',XENDIT_BILLING_ENABLED:'false'};
 requireDisposable(env);
 for(const change of [{TENANT_SELF_DEVELOPMENT_MODE:''},{DATABASE_URL:'postgresql://postgres:fictional@hosted.test:5432/app_db'},
 {SECURITY_SMOKE_URL:'https://hosted.test'},{WORKER_ENABLED:'true'},{XENDIT_SECRET_KEY:'forbidden'},{XENDIT_PAYOUTS_ENABLED:'true'}])assert.throws(()=>requireDisposable({...env,...change}),/REFUSED/);
});
test('GET proves exact nonempty own plans and rejects foreign/hidden/extra evidence',()=>{
 const b=before(),response={status:200,json:{plans:b.plans.filter(p=>p.employeeVisible).map(plan=>({...plan,skill:b.skills[0],milestones:b.milestones.filter(m=>m.planId===plan.id),progress:[]}))}};
 proveRead(response,b,actor);
 for(const edit of [r=>{r.json.plans=[];},r=>{r.json.plans[0].employeeId=99;},r=>{r.json.plans[0].milestones=[];},r=>{r.json.plans.push({...b.plans[3],milestones:[],progress:[],skill:b.skills[0]});},r=>{r.json.plans[0].secret='unexpected';}]){const changed=structuredClone(response);edit(changed);assert.throws(()=>proveRead(changed,b,actor));}
 assert.throws(()=>proveRead(response,b,{...actor,org:{id:99}}));
});
test('POST requires a real own progress insert, author, value, immutable sources and exact audit',()=>{
 const b=before(),after=structuredClone(b),row={id:71,organizationId:11,employeeId:21,planId:41,authorUserId:31,authorEmployeeId:21,authorName:actor.ess.name,content:'Fictional progress',progressPercent:25,createdAt:'2026-10-27T00:00:00Z'};
 after.progress.push(row);after.audits.push({id:81,organizationId:11,actor:actor.ess.name,action:'Employee added skill development progress',resource:actor.open.title,metadata:{developmentPlanId:41,progressUpdateId:71,progressPercent:25}});
 const response={status:201,json:row};proveProgress(b,after,actor,response,'Fictional progress',25);
 assert.throws(()=>proveProgress(b,b,actor,response,'Fictional progress',25));
 for(const edit of [a=>{a.progress[0].organizationId=99;},a=>{a.progress[0].authorUserId=99;},a=>{a.payroll.push({id:1});},a=>{a.audits[0].metadata.developmentPlanId=99;}]){const changed=structuredClone(after);edit(changed);assert.throws(()=>proveProgress(b,changed,actor,response,'Fictional progress',25));}
});
test('PATCH completion requires exact actor, milestone, immutable fields, and audit',()=>{
 const b=before(),after=structuredClone(b),row=after.milestones[0];Object.assign(row,{status:'completed',updatedAt:'2026-10-27T01:00:00Z',completedAt:'2026-10-27T01:00:00Z',completedByUserId:31,completedByName:actor.ess.name});
 after.audits.push({id:81,organizationId:11,actor:actor.ess.name,action:'Employee completed development milestone',resource:row.title,metadata:{developmentPlanId:41,milestoneId:51,status:'completed'}});
 const response={status:200,json:row};proveMilestone(b,after,actor,response,'completed');
 assert.throws(()=>proveMilestone(b,b,actor,response,'completed'));
 for(const edit of [a=>{a.milestones[0].organizationId=99;},a=>{a.milestones[0].completedByUserId=99;},a=>{a.milestones[0].title='rewritten';},a=>{a.payroll.push({id:1});}]){const changed=structuredClone(after);edit(changed);assert.throws(()=>proveMilestone(b,changed,actor,response,'completed'));}
});
test('only complete source-bound local receipts can support the three provisional credits',()=>{
 const receipt=verifyReceipt();
 for(const alter of [r=>{r.methods.pop();},r=>{r.run.denied=0;},r=>{r.run.progressProofs=0;},r=>{r.run.milestoneProofs=0;},
  r=>{r.mutation.rejected=false;},r=>{r.sources[0].sha256='0'.repeat(64);},r=>{r.run.victimDatabaseUnchanged=false;}]){
  const broken=structuredClone(receipt);alter(broken);assert.throws(()=>verifyReceipt(broken));
 }
 const manifest=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
 const methods=Object.values(manifest.allApiRouteFiles).find(record=>record.route==='self/performance/development-plans').methods;
 for(const method of methods){assert.equal(method.status,'COVERED');assert.equal(method.testedBy.localReceipt,RECEIPT);assert.equal(method.testedBy.postgresMajor,receipt.postgresMajor);}
 assert.equal(verifyCredits(manifest),3);
 for(const edit of [m=>{m.testedBy.ownPositiveLine=1;},m=>{m.testedBy.foreignDenialLine=1;},m=>{m.testedBy.proofSha256='0'.repeat(64);},m=>{m.testedBy.localReceipt='invented';}]){
  const broken=structuredClone(manifest),record=Object.values(broken.allApiRouteFiles).find(row=>row.route==='self/performance/development-plans');edit(record.methods[0]);assert.throws(()=>verifyCredits(broken));
 }
});
