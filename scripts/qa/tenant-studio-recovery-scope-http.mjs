/** Fictional owned PG16/localhost HTTP; no providers and no method credit. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {blob} from './tenant-studio-language-contract.mjs';
import {SOURCE_PINS,requireScopeEnv,verifyScopeSources,assertOwnedRecovery} from './tenant-studio-recovery-scope-contract.mjs';

export async function proveRecoveryScope(){
 const origin=requireScopeEnv();verifyScopeSources();
 const [{db,pool},s,orm,fixture,{lockAutomationRecoveryScope}]=await Promise.all([
  import('../../src/db/index.ts'),import('../../src/db/schema.ts'),import('drizzle-orm'),
  import('./tenant-table-http.mjs'),import('../../src/lib/automation-recovery-scope.ts')]);
 const {eq,asc,inArray}=orm,plain=x=>JSON.parse(JSON.stringify(x));
 const modes=['retry-execution-step','replay-execution'];
 const types=['revoke_sessions','deactivate_access','assign_permission_set','assign_benefit'];
 let own=0,denials=0,discriminations=0,locks=0;const actors=[];
 async function snapshot(actor){
  const out={};for(const key of ['organizations','employees','employeePayProfiles','automationRules','automationExecutions',
   'automationRuleVersions','automationOperationalCases','automationEventLog','userOrganizations','permissionSets',
   'userPermissionAssignments','benefitPlans','benefitEnrollments','scimIdentities','auditEvents','outbox','payrollRuns']){
    const t=s[key];out[key]=plain(await db.select().from(t).where(eq(key==='organizations'?t.id:t.organizationId,actor.org.id)).orderBy(asc(t.id)));
  }
  const ids=[actor.owner.id,...(actor.target?[actor.target.id]:[])];
  out.users=plain(await db.select().from(s.users).where(inArray(s.users.id,ids)).orderBy(asc(s.users.id)));
  out.sessions=plain(await db.select().from(s.sessions).where(inArray(s.sessions.userId,ids)).orderBy(asc(s.sessions.id)));
  return out;
 }
 async function all(){return Promise.all(actors.map(snapshot));}
 async function request(actor,mode,execution,orgId=actor.org.id){
  const r=await fetch(origin+'/api/automation-studio',{method:'POST',headers:{cookie:actor.cookie,origin,
   'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({organizationId:orgId,action:mode,executionId:execution.id,stepIndex:0}),signal:AbortSignal.timeout(30000)});
  const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=null;}return {status:r.status,json,text};
 }
 async function deny(actor,mode,e,status,label,orgId){
  const before=await all(),r=await request(actor,mode,e,orgId);
  assert.equal(r.status,status,label);assert.equal(r.json?.execution,undefined,label+': disclosed execution');
  for(const a of actors)assert.ok(!r.text.includes(a.marker),label+': private marker');
  assert.deepEqual(await all(),before,label+': changed protected business/session/audit state');denials++;
 }
 async function execution(actor,action,overrides={}){
  const [rule]=await db.insert(s.automationRules).values({organizationId:actor.org.id,name:actor.marker+' '+randomUUID(),
   trigger:'employee.separated',active:false,publishedVersion:0,draftVersion:1,actions:[action]}).returning();
  const [e]=await db.insert(s.automationExecutions).values({organizationId:actor.org.id,ruleId:rule.id,employeeId:actor.worker.id,
   trigger:'employee.separated',eventKey:actor.marker+'-'+randomUUID(),status:'failed',cursor:1,workflow:[action],context:{},
   result:[{type:action.type,stepIndex:0,status:'failed',error:'Fictional interrupted action'}],...overrides}).returning();return e;
 }
 async function action(actor,type){
  if(type==='assign_permission_set'){
   const [p]=await db.insert(s.permissionSets).values({organizationId:actor.org.id,name:'Fictional '+randomUUID(),permissions:[],active:true}).returning();return {type,permissionSetId:p.id};
  }
  if(type==='assign_benefit'){
   const [p]=await db.insert(s.benefitPlans).values({organizationId:actor.org.id,name:'Fictional '+randomUUID(),category:'voluntary',employeeShare:'1.00',active:true}).returning();return {type,planId:p.id};
  }return {type};
 }
 try{
  const version=Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);assert.ok(version>=160000&&version<170000);
  assert.equal((await db.select().from(s.organizations).limit(1)).length,0,'Fresh disposable database required');
  const nonce=randomUUID().slice(0,8);for(const label of ['ATTA','ATTB','FILL0','FILL1','FILL2','FILL3','FILL4','FILL5','FILL6','VICTIM']){
   const a=await fixture.seedEmployer(label,nonce,fixture.standaloneMakeSession);a.label=label;
   const [target]=await db.insert(s.users).values({email:'scope-'+randomUUID()+'@example.invalid',name:a.marker+' worker login',
    passwordHash:'fictional-session-only',role:'employee',employeeId:a.worker.id}).returning();a.target=target;
   const [membership]=await db.insert(s.userOrganizations).values({userId:target.id,organizationId:a.org.id,role:'employee',active:true}).returning();a.membership=membership;
   await fixture.standaloneMakeSession(target.id);actors.push(a);
  }
  const victim=actors.at(-1);assert.ok(victim.org.id>Math.max(actors[0].org.id,actors[1].org.id,6));
  const victimExecution=await execution(victim,{type:'revoke_sessions'});
  for(const a of actors.slice(0,2))for(const mode of modes)for(const type of types){
   const step=await action(a,type),source=await execution(a,step);
   await db.update(s.userOrganizations).set({active:true}).where(eq(s.userOrganizations.id,a.membership.id));
   const freshSession=await fixture.standaloneMakeSession(a.target.id);
   const before=await all(),response=await request(a,mode,source);
   const [persisted]=response.json?.execution?.id?await db.select().from(s.automationExecutions).where(eq(s.automationExecutions.id,response.json.execution.id)):[];
   assertOwnedRecovery(response,a,source,mode,plain(persisted));
   const after=await all(),index=actors.indexOf(a);for(let i=0;i<actors.length;i++)if(i!==index)assert.deepEqual(after[i],before[i],'own write modified another employer');
   const oldAudits=before[index].auditEvents;assert.deepEqual(after[index].auditEvents.filter(x=>oldAudits.some(y=>y.id===x.id)),oldAudits,'prior audits changed');
   const state=after[index];
   if(type==='revoke_sessions'||type==='deactivate_access')assert.ok(state.sessions.find(x=>x.id===freshSession.id)?.revokedAt,'real worker session must be revoked');
   if(type==='deactivate_access')assert.equal(state.userOrganizations.find(x=>x.id===a.membership.id).active,false);
   if(type==='assign_permission_set')assert.ok(state.userPermissionAssignments.some(x=>x.userOrganizationId===a.membership.id&&x.permissionSetId===step.permissionSetId));
   if(type==='assign_benefit')assert.ok(state.benefitEnrollments.some(x=>x.employeeId===a.worker.id&&x.planId===step.planId&&x.status==='active'));
   const forged=structuredClone(response);forged.json.execution.organizationId=victim.org.id;forged.json.execution.employeeId=victim.worker.id;
   assert.throws(()=>assertOwnedRecovery(forged,a,source,mode,forged.json.execution),/accepts another employer's data/);discriminations++;own++;
   await deny(a,mode,victimExecution,409,'real victim execution under own employer');
   await deny(a,mode,source,403,'foreign organization selector',victim.org.id);
   const foreignWorker=await execution(a,step,{employeeId:victim.worker.id});
   await deny(a,mode,foreignWorker,409,'owned execution with foreign worker FK');
   const foreignRule=await execution(a,step,{ruleId:victimExecution.ruleId});
   await deny(a,mode,foreignRule,409,'owned execution with foreign rule FK');
  }
  // A transfer cannot race the verified binding while recovery holds the lock.
  const a=actors[0],e=await execution(a,{type:'revoke_sessions'}),before=await all();
  await db.transaction(async tx=>{
   await lockAutomationRecoveryScope(tx,a.org.id,e.id);
   const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='150ms'");
    await assert.rejects(()=>c.query('UPDATE employees SET organization_id=$1 WHERE id=$2',[victim.org.id,a.worker.id]),error=>error.code==='55P03');locks++;
   }finally{await c.query('ROLLBACK');c.release();}
  });assert.deepEqual(await all(),before,'racing transfer changed state');
  assert.equal(own,16);assert.equal(denials,64);assert.equal(discriminations,16);assert.equal(locks,1);
  const receipt={label:'SOLO_VERIFIED_DEV_RECOVERY',family:'studio-stored-recovery-scope',sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
   postgresMajor:16,sourceBlobs:SOURCE_PINS,proofBlobSha:blob(readFileSync('scripts/qa/tenant-studio-recovery-scope-http.mjs')),
   own,denials,discriminations,locks,twoAttackers:true,higherIdVictim:true,realWorkerSessionEffects:true,unchangedVictim:true,providerCalls:0,methodCredits:0,productionAccepted:false};
  mkdirSync('qa-artifacts',{recursive:true});writeFileSync('qa-artifacts/tenant-studio-recovery-scope.json',JSON.stringify(receipt,null,2)+'\n');
  console.log('STUDIO_RECOVERY_SCOPE_HTTP_COMPLETE '+JSON.stringify(receipt));return receipt;
 }finally{await pool.end();}
}
if(process.argv[1]?.endsWith('tenant-studio-recovery-scope-http.mjs')){
 if(process.argv.includes('--preflight')){requireScopeEnv();verifyScopeSources();console.log('Recovery scope preflight passed');}
 else await proveRecoveryScope();
}
