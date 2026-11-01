import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {guard,METHODS,verifyOwned,rejectAnother} from './tenant-onboarding-contract.mjs';
guard(); // Must precede database/application imports.
const {db,pool}=await import('../../src/db/index.ts');
const s=await import('../../src/db/schema.ts');
const {eq,and}=await import('drizzle-orm');
const {seedEmployer,standaloneMakeSession,standaloneRequest:request,standaloneExpectStatus:status}=await import('./tenant-table-http.mjs');
const {auditBusinessSnapshot}=await import('./tenant-table-invariants.mjs');
const {decryptBankAccount}=await import('../../src/lib/bank-account-crypto.ts');
const {decryptGovernmentId}=await import('../../src/lib/government-id-crypto.ts');
const profile=process.env.TENANT_ONBOARDING_PROFILE;
const names={workers:'employees',entities:'legalEntities',units:'orgUnits',profiles:'jobProfiles',pay:'employeePayProfiles',revisions:'employeePayRevisions',retro:'employeePayRetroAdjustments',rest:'employeeRestDayRevisions',tasks:'provisioningTasks',batches:'importBatches',positions:'positions',assignments:'positionAssignments',events:'workerEmploymentEvents',candidates:'jobApplicants',requisitions:'jobRequisitions',processes:'hcmBusinessProcessInstances',steps:'hcmBusinessProcessInstanceSteps',approvals:'approvalTasks',definitions:'hcmBusinessProcessDefinitions',payoutRequests:'employeePayoutChangeRequests',assets:'assets',devices:'itManagedDevices',deviceEvents:'itDeviceEvents',progress:'firstPayrollJourneyProgress',runs:'payrollRuns'};
async function snapshot(e){
 const result={};for(const[k,name]of Object.entries(names)){const t=s[name];result[k]=await db.select().from(t).where(eq(t.organizationId,e.org.id)).orderBy(t.id??t.step);}
 result.audit=auditBusinessSnapshot(await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId,e.org.id)).orderBy(s.auditEvents.id));
 result.org=await db.select().from(s.organizations).where(eq(s.organizations.id,e.org.id));
 result.entries=await db.select({entry:s.payrollEntries}).from(s.payrollEntries).innerJoin(s.payrollRuns,eq(s.payrollRuns.id,s.payrollEntries.payrollRunId)).where(eq(s.payrollRuns.organizationId,e.org.id)).orderBy(s.payrollEntries.id);
 return result;
}
const nonce=randomUUID().slice(0,7),report={kind:'onboarding-http-v1',profile,methods:METHODS,own:0,denied:0,forged:0,negative:0,discrimination:0,actions:[],coverageCredits:0,productionTested:false};
const captured=new Map();let victim,victimBefore;
async function unchanged(){assert.deepEqual(await snapshot(victim),victimBefore,'victim business/payroll/audit unchanged');}
async function call(e,path,method,body,expected){const r=status(await request(path,{cookie:e.cookie,method,body}),expected,path+' '+method);assert.ok(!r.text.includes(victim.marker),'no victim marker in response');return r;}
async function denied(e,path,method,body,expected=403,kind='denied'){
 const before=await snapshot(e);const r=await call(e,path,method,body,expected);assert.deepEqual(await snapshot(e),before,'denied request is atomic/no own changes');await unchanged();report[kind]++;return r;
}
async function perform(e,key,label,body,expected,check,{foreign,forged=[]}={}){
 const [method,route]=key.split(' '),path='/api/'+route,before=await snapshot(e);
 const r=await call(e,path,method,body,expected),after=await snapshot(e);check(before,after,e,r);
 if(e.label==='ATTB'){const prior=captured.get(key+':'+label);assert.ok(prior,'first attacker result required');rejectAnother(check,prior.before,prior.after,e,prior.r);report.discrimination++;}
 else captured.set(key+':'+label,{before,after,r});
 await unchanged();report.own++;report.actions.push({key,label,attacker:e.label,status:r.status});
 if(foreign)await denied(e,path,method,foreign);
 for(const f of forged)await denied(e,path,method,f.body,f.status,'forged');
 return r;
}
const csv=(e,no,extra='')=>'Employee No,First Name,Last Name,Title,Employment Type,Status,Start Date,Monthly Basic,MWE,Region,Email,Mobile,Bank Account,Bank Code'+(extra?',Department':'')+'\n'+[no,'Fictional',e.marker,'QA Worker','Regular','Active','2026-01-05','26000','no','NCR',no.toLowerCase()+'@example.invalid','','','',...(extra?[extra]:[])].join(',');
const createBody=(e,no)=>({organizationId:e.org.id,employeeNo:no,firstName:'Fictional',lastName:e.marker,title:'QA worker',startDate:'2026-01-05',region:'NCR',rateAmount:26000,payBasis:'monthly',legalEntityId:e.entity.id});
function employeeCheck(fields,created=false){return(b,a,e,r)=>{
 const row=r.json.employee??r.json;verifyOwned(b,a,e,{table:'workers',id:row.id,fields:typeof fields==='function'?fields(e):fields,created});
 const pay=a.pay.find(p=>p.employeeId===row.id);assert.equal(pay?.organizationId,e.org.id);assert.equal(Number(pay.rateAmount),Number(row.basicRate));
};}
async function seed(e){
 await db.update(s.organizations).set({accountType:'enterprise'}).where(eq(s.organizations.id,e.org.id));
 const[p]=await db.insert(s.jobProfiles).values({organizationId:e.org.id,title:e.marker+' role'}).returning();
 for(let i=0;i<2;i++)await db.insert(s.positions).values({organizationId:e.org.id,jobProfileId:p.id,code:e.marker+'-PAD-'+i,status:'planned'});
 const[position]=await db.insert(s.positions).values({organizationId:e.org.id,jobProfileId:p.id,orgUnitId:e.unit.id,legalEntityId:e.entity.id,code:e.marker.slice(0,40),status:'open',annualBudget:'400000.00'}).returning();e.position=position;
 const[req]=await db.insert(s.jobRequisitions).values({organizationId:e.org.id,positionId:position.id,title:p.title,department:e.marker,status:'open'}).returning();
 for(let i=0;i<2;i++)await db.insert(s.jobApplicants).values({organizationId:e.org.id,requisitionId:req.id,fullName:e.marker+' padding '+i,email:e.marker+'-pad'+i+'@example.invalid',stage:'rejected'});
 const[candidate]=await db.insert(s.jobApplicants).values({organizationId:e.org.id,requisitionId:req.id,fullName:e.marker+' candidate',email:e.marker.toLowerCase()+'-hire@example.invalid',stage:'offer',offeredSalary:'26000.00'}).returning();e.candidate=candidate;e.req=req;
 const[checker]=await db.insert(s.users).values({email:e.marker.toLowerCase()+'-checker@example.invalid',name:e.marker+' checker',passwordHash:'fictional-session-only',role:'hr',totpEnabled:true}).returning();
 await db.insert(s.userOrganizations).values({organizationId:e.org.id,userId:checker.id,role:'hr',active:true});
 const session=await standaloneMakeSession(checker.id);await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,session.id));e.checker={...e,owner:checker,cookie:session.cookie};
 // Same employee number is valid independently per employer; real victim exists before requests.
 const[shared]=await db.insert(s.employees).values({organizationId:e.org.id,legalEntityId:e.entity.id,employeeNo:'SHARED-FICTIONAL',firstName:'Fictional',lastName:e.marker,title:'Fictional shared number',avatarInitials:'QA',basicRate:'26000.00',startDate:'2026-01-05',region:'NCR'}).returning();
 await db.insert(s.employeePayProfiles).values({organizationId:e.org.id,employeeId:shared.id,payBasis:'monthly',rateAmount:'26000.00',standardWorkDaysPerMonth:'22.00',standardHoursPerDay:'8.00'});
}
async function run(e){
 const no=e.marker+'-NEW';
 const created=await perform(e,'POST employees','direct-create',{...createBody(e,no),assetName:e.marker+' fictional workstation'},201,employeeCheck(x=>({employeeNo:x.marker+'-NEW',lastName:x.marker,legalEntityId:x.entity.id}),true),{
  foreign:{...createBody(victim,victim.marker+'-foreign'),legalEntityId:victim.entity.id},forged:[{body:{...createBody(e,e.marker+'-forged'),legalEntityId:victim.entity.id},status:422}]});
 e.createdId=(created.json.employee??created.json).id;
 const state=await snapshot(e);assert.equal(state.tasks.filter(t=>t.employeeId===e.createdId&&t.kind==='onboarding').length,5);
 assert.ok(state.assets.some(a=>a.employeeId===e.createdId&&a.organizationId===e.org.id&&a.status==='assigned'));assert.ok(state.devices.some(d=>d.employeeId===e.createdId&&d.organizationId===e.org.id));
 await denied(e,'/api/employees','POST',createBody(e,no),409,'negative');
 await denied(e,'/api/employees','POST',{...createBody(e,no+'-bad'),region:'UNKNOWN'},422,'negative');
 await denied(e,'/api/employees','POST',{...createBody(e,no+'-bad-date'),startDate:'2026-02-30'},400,'negative');
 const patchBase={organizationId:e.org.id,employeeId:e.createdId};
 const patches=[
  ['identity',{middleName:'QA',tin:'123456789',sssNo:'1234567890',philHealthNo:'123456789012',pagIbigNo:'123456789012',nationality:'Filipino',pagIbigVoluntaryMonthly:100},{middleName:'QA',pagIbigVoluntaryMonthly:'100.00'}],
  ['start-date',{startDate:'2026-01-06'},{startDate:'2026-01-06'}],
  ['rest-day',{restDay:'Sunday',restDayEffectiveDate:'2026-01-15',restDayChangeReason:'Fictional schedule correction'},{restDay:'Sunday'}],
  ['pay-profile',{rateAmount:27000,payEffectiveDate:'2026-01-15',payChangeReason:'Fictional pre-payroll correction'},{basicRate:'27000.00'}],
  ['initial-payout',{bankAccount:'QA-FICTIONAL-'+e.marker,bankCode:'BDO',mobile:'QA-ONLY-'+e.label,payoutChangeReason:'Fictional initial setup no payment'},{bankCode:'BDO'}],
 ];
 for(const[label,fields,wanted]of patches){
  const r=await perform(e,'PATCH employees',label,{...patchBase,...fields},200,employeeCheck(wanted),{foreign:{...patchBase,...fields,organizationId:victim.org.id,employeeId:victim.worker.id},forged:[{body:{...patchBase,...fields,employeeId:victim.worker.id},status:404}]});
  const a=await snapshot(e),worker=a.workers.find(w=>w.id===r.json.employee.id);
  if(label==='identity'){assert.equal(decryptGovernmentId(worker.tin),'123456789');assert.notEqual(worker.tin,'123456789');assert.ok(!r.text.includes('123456789'));}
  if(label==='initial-payout'){assert.equal(decryptBankAccount(worker.bankAccount),fields.bankAccount);assert.notEqual(worker.bankAccount,fields.bankAccount);assert.ok(!r.text.includes(fields.bankAccount));}
  if(label==='rest-day')assert.equal(a.rest.filter(x=>x.employeeId===e.createdId).length,1);
  if(label==='pay-profile')assert.equal(a.revisions.filter(x=>x.employeeId===e.createdId).length,1);
 }
 await denied(e,'/api/employees','PATCH',{...patchBase,startDate:'not-a-date'},400,'negative');
 await denied(e,'/api/employees','PATCH',{...patchBase,startDate:'2026-02-30'},400,'negative');
 await denied(e,'/api/employees','PATCH',{...patchBase,startDate:'2099-01-01'},422,'negative');
 const number=e.marker+'-CSV',body={organizationId:e.org.id,csv:csv(e,number),fileName:e.marker+'.csv'};
 if(profile==='preview'){
  const before=await snapshot(e),p=await call(e,'/api/employees/import','POST',{...body,action:'preview'},200);assert.equal(p.json.newEligibleCount,1);assert.ok(p.json.previewToken);assert.deepEqual(await snapshot(e),before,'preview is read-only');
  await denied(e,'/api/employees/import','POST',{...body,action:'commit',previewToken:'invalid'},409,'negative');
  body.action='commit';body.previewToken=p.json.previewToken;
 }
 const importCheck=(b,a,x,r)=>{const worker=a.workers.find(w=>w.employeeNo===x.marker+'-CSV');assert.ok(worker);verifyOwned(b,a,x,{table:'workers',id:worker.id,fields:{employeeNo:x.marker+'-CSV',lastName:x.marker,legalEntityId:x.entity.id},created:true});assert.equal(r.json.createdCount,1);const batch=a.batches.find(z=>z.id===r.json.batchId);assert.equal(batch?.organizationId,x.org.id);assert.equal(batch.createdCount,1);assert.ok(a.pay.some(p=>p.employeeId===worker.id&&p.organizationId===x.org.id));};
 await perform(e,'POST employees/import','commit',body,200,importCheck,{foreign:{...body,organizationId:victim.org.id}});
 if(profile==='legacy')await perform(e,'POST employees/import','dry-run',{...body,csv:csv(e,e.marker+'-DRY'),dryRun:true},200,(b,a,x,r)=>{verifyOwned(b,a,x,{table:'batches',id:r.json.batchId,fields:{createdCount:0,createdBy:x.owner.name},created:true});assert.deepEqual(a.workers,b.workers);assert.deepEqual(a.pay,b.pay);},{foreign:{...body,csv:csv(e,e.marker+'-DRY'),organizationId:victim.org.id,dryRun:true}});
 const duplicate={...body};if(profile==='preview'){duplicate.action='preview';delete duplicate.previewToken;const p=await call(e,'/api/employees/import','POST',duplicate,200);assert.equal(p.json.blockingErrorCount,1);duplicate.action='commit';duplicate.previewToken=p.json.previewToken;}
 await denied(e,'/api/employees/import','POST',duplicate,422,'negative');
 const invalid={organizationId:e.org.id,csv:'Employee No,First Name\nBROKEN,Only',fileName:'invalid.csv'};
 if(profile==='legacy')await denied(e,'/api/employees/import','POST',invalid,422,'negative');
 else {const before=await snapshot(e),p=await call(e,'/api/employees/import','POST',{...invalid,action:'preview'},200);assert.ok(p.json.fileErrors.length);await denied(e,'/api/employees/import','POST',{...invalid,action:'commit',previewToken:p.json.previewToken},422,'negative');assert.deepEqual(await snapshot(e),before);}
 const inactive={organizationId:e.org.id,csv:csv(e,e.marker+'-INACTIVE'),fileName:'inactive-employer.csv'};
 if(profile==='preview'){const p=await call(e,'/api/employees/import','POST',{...inactive,action:'preview'},200);inactive.action='commit';inactive.previewToken=p.json.previewToken;}
 await db.update(s.legalEntities).set({active:false}).where(eq(s.legalEntities.id,e.entity.id));
 await denied(e,'/api/employees/import','POST',inactive,422,'negative');
 await db.update(s.legalEntities).set({active:true}).where(eq(s.legalEntities.id,e.entity.id));
 if(profile==='preview'){
  const foreignDepartment={organizationId:e.org.id,csv:csv(e,e.marker+'-DEPT',victim.unit.code),fileName:'foreign-department.csv'};
  const p=await call(e,'/api/employees/import','POST',{...foreignDepartment,action:'preview'},200);assert.equal(p.json.blockingErrorCount,1);
  await denied(e,'/api/employees/import','POST',{...foreignDepartment,action:'commit',previewToken:p.json.previewToken},422,'forged');
  const stale={organizationId:e.org.id,csv:csv(e,e.marker+'-STALE'),fileName:'stale.csv'},preview=await call(e,'/api/employees/import','POST',{...stale,action:'preview'},200);
  await denied(e,'/api/employees/import','POST',{...stale,csv:csv(e,e.marker+'-CHANGED'),action:'commit',previewToken:preview.json.previewToken},409,'negative');
 }
 // Configure the real Hire policy only after direct intake/import tests.
 await db.insert(s.hcmBusinessProcessDefinitions).values({organizationId:e.org.id,code:'qa-hire',name:'Fictional independent review',processType:'hire',effectiveFrom:'2026-01-01',steps:[{type:'approval',label:'Independent HR',assignee:'role:hr',priority:'High',dueDays:2}]});// fixture, not an approval
 const hire={applicantId:e.candidate.id,employeeNo:e.marker+'-HIRE',firstName:'Fictional',lastName:e.marker,startDate:'2026-01-05',region:'NCR',rateAmount:26000,payBasis:'monthly'};
 await denied(e,'/api/recruitment/hire','POST',{...hire,startDate:'2026-02-30'},400,'negative');
 const submitCheck=(b,a,x,r)=>{const id=r.json.businessProcess.id;verifyOwned(b,a,x,{table:'processes',id,fields:{sourceType:'recruitment_hire',status:'in_progress',initiatedByUserId:x.owner.id},created:true});assert.deepEqual(a.workers,b.workers,'no premature worker');assert.deepEqual(a.pay,b.pay,'no premature pay profile');};
 const pending=await perform(e,'POST recruitment/hire','submit',hire,202,submitCheck,{foreign:{...hire,applicantId:victim.candidate.id},forged:[{body:{...hire,organizationId:e.org.id,applicantId:victim.candidate.id},status:403}]});
 const retryBefore=await snapshot(e),retry=await call(e,'/api/recruitment/hire','POST',hire,202);assert.equal(retry.json.businessProcess.id,pending.json.businessProcess.id);assert.deepEqual(await snapshot(e),retryBefore,'submission is idempotent');
 const processId=pending.json.businessProcess.id;const[step]=await db.select().from(s.hcmBusinessProcessInstanceSteps).where(eq(s.hcmBusinessProcessInstanceSteps.instanceId,processId));assert.ok(step.approvalTaskId);
 await denied(e,'/api/approvals/'+step.approvalTaskId,'PATCH',{status:'Approved'},403,'negative');
 const checkerBefore=await snapshot(e);await call(e.checker,'/api/approvals/'+step.approvalTaskId,'PATCH',{status:'Approved'},200);const checked=await snapshot(e);assert.equal(checked.processes.find(p=>p.id===processId).status,'approved');assert.deepEqual(checked.workers,checkerBefore.workers);
 const hireCheck=(b,a,x,r)=>{employeeCheck(y=>({employeeNo:y.marker+'-HIRE',legalEntityId:y.entity.id,orgUnitId:y.unit.id}),true)(b,a,x,r);assert.equal(r.json.businessProcess.status,'applied');assert.equal(a.candidates.find(c=>c.id===x.candidate.id).hiredEmployeeId,r.json.employee.id);assert.ok(a.assignments.some(z=>z.employeeId===r.json.employee.id&&z.organizationId===x.org.id));assert.equal(a.tasks.filter(t=>t.employeeId===r.json.employee.id).length,5);assert.equal(a.positions.find(p=>p.id===x.position.id).status,'filled');};
 await perform(e,'POST recruitment/hire','convert',hire,201,hireCheck,{foreign:{...hire,applicantId:victim.candidate.id}});
 await denied(e,'/api/recruitment/hire','POST',hire,409,'negative');
 await denied(e,'/api/employees','POST',createBody(e,e.marker+'-bypass'),409,'negative');
 await denied(e,'/api/employees/import','POST',{organizationId:e.org.id,csv:csv(e,e.marker+'-bypass'),fileName:'bypass.csv',...(profile==='preview'?{action:'preview'}:{})},409,'negative');
 const directory=await call(e,'/api/employees?organizationId='+e.org.id,'GET',undefined,200);for(const id of[e.createdId,(await snapshot(e)).workers.find(w=>w.employeeNo===e.marker+'-HIRE').id]){const row=directory.json.find(w=>w.id===id);assert.equal(row.organizationId,e.org.id);assert.ok(Number(row.payRate)>0);}
 const beforePreview=await snapshot(e),q='&periodStart=2026-01-01&periodEnd=2026-01-15&payDate=2026-01-20';
 const preview=await call(e,'/api/first-payroll/preview?organizationId='+e.org.id+q,'GET',undefined,200);
 assert.equal(preview.json.organizationId,e.org.id);assert.equal(preview.json.previewReady,false,'missing reviewer/schedule evidence must remain blocked');assert.ok(preview.json.blockers.length);
 for(const id of[e.createdId,beforePreview.workers.find(w=>w.employeeNo===e.marker+'-HIRE').id]){const row=preview.json.rows.find(w=>w.employeeId===id);assert.ok(row,'new direct/hired workers reach canonical preview');assert.equal(row.net,null,'blocked preview must never look like zero pay');}
 assert.deepEqual(await snapshot(e),beforePreview,'canonical preview must not write');await denied(e,'/api/first-payroll/preview?organizationId='+victim.org.id+q,'GET',undefined,403,'negative');
}
try{
 const version=Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);assert.equal(Math.floor(version/10000),16);report.postgresMajor=16;
 assert.equal(Number((await pool.query('select count(*)::int as n from organizations')).rows[0].n),0,'fresh empty fictional database required');
 for(let i=0;i<6;i++)await seedEmployer('PAD'+i,nonce,standaloneMakeSession);
 const attackers=[];for(const label of['ATTA','ATTB']){const e=await seedEmployer(label,nonce,standaloneMakeSession);await seed(e);attackers.push(e);}
 victim=await seedEmployer('VICTIM',nonce,standaloneMakeSession);await seed(victim);for(const e of attackers)for(const key of['org','worker','entity','unit','candidate','position'])assert.ok(victim[key].id>e[key].id&&victim[key].id>6,'real higher-ID victim '+key);
 victimBefore=await snapshot(victim);for(const e of attackers)await run(e);await unchanged();report.victimUnchanged=true;
 mkdirSync('outputs',{recursive:true});writeFileSync('outputs/onboarding-'+profile+'.json',JSON.stringify(report,null,2)+'\n');console.log('ONBOARDING_REAL_HTTP '+JSON.stringify(report));
}finally{await pool.end();}
