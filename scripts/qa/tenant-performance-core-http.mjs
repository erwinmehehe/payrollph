import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {asc,eq} from 'drizzle-orm';
import {guard,METHODS,ACTIONS,verifyOwnChange,rejectOtherEmployer} from './tenant-performance-core-contract.mjs';
import {auditBusinessSnapshot} from './tenant-table-invariants.mjs';
guard();
const {db,pool}=await import('../../src/db/index.ts');
const t=await import('../../src/db/schema.ts');
const {seedEmployer,standaloneMakeSession,standaloneRequest:request,standaloneExpectStatus:status,victimSnapshot}=await import('./tenant-table-http.mjs');
const plain=v=>JSON.parse(JSON.stringify(v));
const names=Object.keys(t).filter(name=>name.startsWith('performance')&&t[name]?.organizationId);
names.push('auditEvents','payrollRuns','employeePayProfiles');
const snapshot=async org=>{
 const out={};for(const name of names)out[name]=plain(await db.select().from(t[name]).where(eq(t[name].organizationId,org)).orderBy(asc(t[name].id)));
 // Hash-chain linkage can be global: compare audit business fields, separately from core victim snapshot.
 out.auditEvents=plain(auditBusinessSnapshot(out.auditEvents));
 return out;
};
async function fixture(e){
 const insert=async(name,values)=>(await db.insert(t[name]).values({organizationId:e.org.id,...values}).returning())[0];
 const cycle=async(label,status='active')=>insert('performanceCycles',{name:e.marker+' '+label,startDate:'2026-01-01',endDate:'2026-12-31',status,requireManagerSummary:true});
 const profile=await insert('jobProfiles',{title:e.marker+' profile'});
 const template=await insert('performanceTemplates',{code:e.marker+'-CORE',name:e.marker+' template',type:'kra',defaultWeight:'100'});
 const createCycle=await cycle('create');const editCycle=await cycle('edit');const calibrationCycle=await cycle('calibration');const sealCycle=await cycle('seal','completed');
 const review=await insert('performanceReviews',{employeeId:e.worker.id,cycleId:editCycle.id,reviewerUserId:e.owner.id,status:'in_progress'});
 const item=await insert('performanceReviewItems',{reviewId:review.id,templateId:template.id,weight:'100',required:true});
 const completedReview=await insert('performanceReviews',{employeeId:e.worker.id,cycleId:calibrationCycle.id,reviewerUserId:e.owner.id,status:'completed',managerScore:'3.00',finalScore:'3.00',managerSummary:e.marker});
 await insert('performanceReviews',{employeeId:e.worker.id,cycleId:sealCycle.id,reviewerUserId:e.owner.id,status:'completed',managerScore:'3.00',finalScore:'3.00',managerSummary:e.marker});
 const goal=await insert('performanceGoals',{employeeId:e.worker.id,title:e.marker+' goal',scope:'employee',progress:0});
 const session=await insert('performanceCalibrationSessions',{cycleId:calibrationCycle.id,name:e.marker+' session',createdByName:e.owner.name,createdByUserId:e.owner.id});
 const entry=await insert('performanceCalibrationEntries',{sessionId:session.id,reviewId:completedReview.id,originalScore:'3.00'});
 const flags=[];for(const flagType of ['high_rating_concentration','low_rating_concentration'])flags.push(await insert('performanceCalibrationFlags',{sessionId:session.id,reviewId:completedReview.id,reviewerUserId:e.owner.id,flagType,title:e.marker+' '+flagType,detail:'Fictional outlier only'}));
 return {...e,profile,template,createCycle,editCycle,calibrationCycle,sealCycle,review,item,completedReview,goal,session,entry,flags};
}
let victim,victimBefore,victimCore;const first=new Map(),observations=[];
async function step(actor,label,key,bodyFor,claimFor,forgedFor=()=>[],expected=key.startsWith('POST')?201:200){
 const body=bodyFor(actor),foreign=bodyFor(victim);const [method,...route]=key.split(' ');const path='/api/'+route.join(' ');
 const before=await snapshot(actor.org.id);
 const owned=status(await request(path,{method,cookie:actor.cookie,body}),expected,label+' own HTTP');
 assert.ok(!owned.text.includes(victim.marker),'successful response cannot expose the victim marker');
 const after=await snapshot(actor.org.id),claim=claimFor(owned.json,before,after,actor);
 verifyOwnChange(before,after,actor,claim);
 if(actor.rank===1)first.set(key+label,{before,after,claim});else rejectOtherEmployer(verifyOwnChange,first.get(key+label),actor);
 const denied=status(await request(path,{method,cookie:actor.cookie,body:foreign}),403,label+' victim employer');
 assert.ok(!denied.text.includes(victim.marker));
 const forged=forgedFor(actor,body);for(const forgedBody of forged){
   const refusal=await request(path,{method,cookie:actor.cookie,body:forgedBody});
   assert.ok([403,404].includes(refusal.status),label+' forged reference must deny, got '+refusal.status+' '+refusal.text.slice(0,160));
   assert.ok(!refusal.text.includes(victim.marker));
 }
 assert.deepEqual(await snapshot(actor.org.id),after,'refusals do not mutate attacker state');
 assert.deepEqual(await snapshot(victim.org.id),victimBefore,'every action leaves victim business rows/audit unchanged');
 assert.deepEqual(plain(await victimSnapshot(victim.org.id)),victimCore,'core victim unchanged');
 observations.push({key,label,attacker:actor.label,own:expected,foreign:403,forged:forged.length,discrimination:actor.rank===2});
 console.log(JSON.stringify({key,label,attacker:actor.label,status:'PASS'}));
 return owned.json;
}
const made=(table,fields)=>(json)=>({table,id:json.id,created:true,fields});
const changed=(table,id,fields,readOnly=false)=>()=>({table,id,fields,readOnly});
async function exercise(a){
 const post='POST performance',patch='PATCH performance',cal='PATCH performance/calibration',gov='PATCH performance/follow-through-governance';
 await step(a,'cycle',post,e=>({organizationId:e.org.id,entityType:'cycle',name:e.marker+' HTTP cycle',startDate:'2026-02-01',endDate:'2026-12-31'}),made('performanceCycles',{name:a.marker+' HTTP cycle',status:'active'}));
 await step(a,'template',post,e=>({organizationId:e.org.id,entityType:'template',code:e.marker+'-HTTP',name:e.marker+' HTTP template',type:'competency',defaultWeight:50,jobProfileId:e.profile.id}),made('performanceTemplates',{name:a.marker+' HTTP template',jobProfileId:a.profile.id,defaultWeight:'50.00'}),(e,b)=>[{...b,jobProfileId:victim.profile.id}]);
 await step(a,'cycle_template',post,e=>({organizationId:e.org.id,entityType:'cycle_template',cycleId:e.createCycle.id,templateId:e.template.id,weight:100}),made('performanceCycleTemplates',{cycleId:a.createCycle.id,templateId:a.template.id,weight:'100.00'}),(e,b)=>[{...b,cycleId:victim.createCycle.id},{...b,templateId:victim.template.id}]);
 for(const scope of ['company','team','employee'])await step(a,'goal-'+scope,post,e=>({organizationId:e.org.id,entityType:'goal',scope,title:e.marker+' '+scope+' HTTP goal',weight:25,cycleId:e.createCycle.id,...(scope==='team'?{orgUnitId:e.unit.id}:scope==='employee'?{employeeId:e.worker.id}:{})}),made('performanceGoals',{scope,title:a.marker+' '+scope+' HTTP goal',employeeId:scope==='employee'?a.worker.id:null,orgUnitId:scope==='team'?a.unit.id:null}),(e,b)=>[{...b,cycleId:victim.createCycle.id},...(scope==='team'?[{...b,orgUnitId:victim.unit.id}]:scope==='employee'?[{...b,employeeId:victim.worker.id}]:[])]);
 await step(a,'review',post,e=>({organizationId:e.org.id,entityType:'review',employeeId:e.worker.id,cycleId:e.createCycle.id}),made('performanceReviews',{employeeId:a.worker.id,cycleId:a.createCycle.id,status:'in_progress'}),(e,b)=>[{...b,employeeId:victim.worker.id},{...b,cycleId:victim.createCycle.id}]);
 await step(a,'goal',patch,e=>({entityType:'goal',id:e.goal.id,progress:60}),changed('performanceGoals',a.goal.id,{progress:60}), (e,b)=>[{...b,organizationId:e.org.id,id:victim.goal.id}]);
 await step(a,'review_item',patch,e=>({entityType:'review_item',id:e.item.id,managerScore:4,finalScore:4,managerComment:e.marker}),changed('performanceReviewItems',a.item.id,{managerScore:'4.00',finalScore:'4.00',managerComment:a.marker}),(e,b)=>[{...b,organizationId:e.org.id,id:victim.item.id}]);
 for(const state of ['in_progress','completed'])await step(a,'review-'+(state==='in_progress'?'in-progress':'completed'),patch,e=>({entityType:'review',id:e.review.id,status:state,managerScore:4,finalScore:4,managerSummary:e.marker+' summary'}),changed('performanceReviews',a.review.id,{status:state,managerScore:'4.00',finalScore:'4.00',managerSummary:a.marker+' summary'}),(e,b)=>[{...b,organizationId:e.org.id,id:victim.review.id}]);
 await step(a,'cycle',patch,e=>({entityType:'cycle',id:e.editCycle.id}),changed('performanceCycles',a.editCycle.id,{status:'completed',completedByUserId:a.owner.id}),(e,b)=>[{...b,organizationId:e.org.id,id:victim.editCycle.id}]);
 const policy=(e,version)=>({organizationId:e.org.id,action:'policy',expectedVersion:version,minimumManagerSample:10+e.rank+version,managerMeanDeviationThreshold:1,highRatingThreshold:4,highRatingShareThreshold:80,lowRatingThreshold:2,lowRatingShareThreshold:50,largeScoreChangeThreshold:1,requireFlagResolution:true});
 for(const version of [0,1])await step(a,'policy-'+(version?'update':'create'),cal,e=>policy(e,version),(j,b,after)=>({table:'performanceCalibrationPolicies',id:after.performanceCalibrationPolicies[0].id,created:!version,fields:{version:version+1,minimumManagerSample:10+a.rank+version,updatedByUserId:a.owner.id}}));
 for(const [index,state] of ['accepted','resolved'].entries())await step(a,'flag-'+state,cal,e=>({organizationId:e.org.id,action:'flag',sessionId:e.session.id,flagId:e.flags[index].id,status:state,resolutionNote:e.marker+' fictional resolution'}),changed('performanceCalibrationFlags',a.flags[index].id,{status:state,resolvedByUserId:a.owner.id}),(e,b)=>[{...b,sessionId:victim.session.id},{...b,flagId:victim.flags[index].id}]);
 await step(a,'score',cal,e=>({organizationId:e.org.id,action:'score',sessionId:e.session.id,entryId:e.entry.id,calibratedScore:3.5,rationale:e.marker+' fictional rationale'}),changed('performanceCalibrationEntries',a.entry.id,{calibratedScore:'3.50',calibratedByUserId:a.owner.id}),(e,b)=>[{...b,sessionId:victim.session.id},{...b,entryId:victim.entry.id}]);
 await step(a,'finalize',cal,e=>({organizationId:e.org.id,action:'finalize',sessionId:e.session.id}),changed('performanceCalibrationSessions',a.session.id,{status:'finalized',finalizedByUserId:a.owner.id}),(e,b)=>[{...b,sessionId:victim.session.id}]);
 const calibrated=await db.select().from(t.performanceReviews).where(eq(t.performanceReviews.id,a.completedReview.id));assert.equal(calibrated[0].finalScore,'3.50');
 for(const version of [0,1])await step(a,'action_reminder_policy-'+(version?'update':'create'),gov,e=>({organizationId:e.org.id,action:'action_reminder_policy',expectedVersion:version,enabled:false,reminderDaysBefore:5+e.rank+version,escalationDaysOverdue:15,notifyManagerOnEmployeeItem:false,notifyPeopleAdminOnEscalation:false}),(j,b,after)=>({table:'performanceActionReminderPolicies',id:after.performanceActionReminderPolicies[0].id,created:!version,fields:{version:version+1,enabled:false,reminderDaysBefore:5+a.rank+version,updatedByUserId:a.owner.id}}));
 for(const version of [0,1])await step(a,'evidence_policy-'+(version?'update':'create'),gov,e=>({organizationId:e.org.id,action:'evidence_policy',expectedVersion:version,retentionYears:5+version,autoSealCompletedCycles:false,allowPostSealAmendments:true}),(j,b,after)=>({table:'performanceEvidencePolicies',id:after.performanceEvidencePolicies[0].id,created:!version,fields:{version:version+1,retentionYears:5+version,updatedByUserId:a.owner.id}}));
 await step(a,'seal_cycle',gov,e=>({organizationId:e.org.id,action:'seal_cycle',cycleId:e.sealCycle.id}),(j)=>({table:'performanceCycleEvidenceSeals',id:j.seal.id,created:true,fields:{cycleId:a.sealCycle.id}}),(e,b)=>[{...b,cycleId:victim.sealCycle.id}]);
 await step(a,'verify_cycle',gov,e=>({organizationId:e.org.id,action:'verify_cycle',cycleId:e.sealCycle.id}),(j,b,after)=>{assert.equal(j.status,'match');assert.equal(j.sealedHash,j.currentHash);return {table:'performanceCycleEvidenceSeals',id:after.performanceCycleEvidenceSeals[0].id,fields:{cycleId:a.sealCycle.id,lastVerificationStatus:'match'}};},(e,b)=>[{...b,cycleId:victim.sealCycle.id}]);
 for(const legalHold of [true,false])await step(a,'legal_hold-'+(legalHold?'on':'off'),gov,e=>({organizationId:e.org.id,action:'legal_hold',cycleId:e.sealCycle.id,legalHold,reason:e.marker+' fictional hold review'}),(j)=>({table:'performanceCycleEvidenceSeals',id:j.id,fields:{cycleId:a.sealCycle.id,legalHold}}),(e,b)=>[{...b,cycleId:victim.sealCycle.id}]);
 await step(a,'amend_seal',gov,e=>({organizationId:e.org.id,action:'amend_seal',cycleId:e.sealCycle.id,employeeId:e.worker.id,reason:e.marker+' fictional amendment',detail:e.marker+' sufficiently detailed fictional amendment evidence'}),made('performanceCycleEvidenceAmendments',{cycleId:a.sealCycle.id,employeeId:a.worker.id,amendmentNumber:1}),(e,b)=>[{...b,cycleId:victim.sealCycle.id},{...b,employeeId:victim.worker.id}]);
}
try{
 const version=Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);assert.equal(Math.floor(version/10000),16);
 const nonce=randomUUID().replaceAll('-','').slice(0,10),employers=[];
 for(const label of ['ATTA','ATTB','VICTIM'])employers.push(await fixture(await seedEmployer(label,nonce,standaloneMakeSession)));
 victim=employers[2];
 for(const field of ['org','worker','unit','entity','profile','template','createCycle','editCycle','calibrationCycle','sealCycle','review','item','goal','session','entry']) {
   assert.ok(victim[field].id>employers[0][field].id&&victim[field].id>employers[1][field].id,'actual higher-ID victim '+field);
 }
 victimBefore=await snapshot(victim.org.id);victimCore=plain(await victimSnapshot(victim.org.id));
 for(const actor of employers.slice(0,2))await exercise(actor);
 for(const key of METHODS)for(const attacker of ['ATTA','ATTB'])assert.deepEqual(observations.filter(r=>r.key===key&&r.attacker===attacker).map(r=>r.label),ACTIONS[key]);
 const receipt={kind:'performance-core-http-v1',methods:METHODS,serverVersionNum:version,actions:observations,own:observations.length,denied:observations.length,forged:observations.reduce((n,r)=>n+r.forged,0),discriminating:observations.filter(r=>r.discrimination).length,victimDatabaseUnchanged:true,coverageCredits:0,productionTested:false,certified:false};
 mkdirSync('outputs',{recursive:true});writeFileSync('outputs/performance-core-run.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await pool.end();}
