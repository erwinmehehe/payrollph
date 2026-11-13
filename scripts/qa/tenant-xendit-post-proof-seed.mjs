/** Precreate allowlisted fictional employers before any payout-capable server starts. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {assertXenditSeedTarget} from './tenant-xendit-post-proof-target.mjs';
assertXenditSeedTarget(process.env);
const [{db,pool},s,{eq},fixture,{encryptBankAccount}]=await Promise.all([
  import('../../src/db/index.ts'),import('../../src/db/schema.ts'),import('drizzle-orm'),
  import('./tenant-table-http.mjs'),import('../../src/lib/bank-account-crypto.ts'),
]);
try{
  assert.equal(Math.floor(Number((await pool.query('show server_version_num')).rows[0].server_version_num)/10000),16);
  for(const table of [s.organizations,s.users])assert.equal((await db.select().from(table).limit(1)).length,0,
    'Only a genuinely empty disposable database may be seeded');
  const nonce=randomUUID().replaceAll('-','').slice(0,8);
  for(let i=0;i<7;i++)await fixture.seedEmployer('PAD'+i,nonce,fixture.standaloneMakeSession);
  async function person(label,port){
    const e=await fixture.seedEmployer(label,nonce,fixture.standaloneMakeSession);
    const addUser=async(suffix,role)=>{
      const[user]=await db.insert(s.users).values({email:e.marker+'-'+suffix+'@example.invalid',
        name:e.marker+' '+suffix,passwordHash:'fictional-session-only',role:'owner',totpEnabled:true}).returning();
      await db.insert(s.userOrganizations).values({organizationId:e.org.id,userId:user.id,role,active:true});
      const session=await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,session.id));
      return{user,cookie:session.cookie};
    };
    const releaser=await addUser('separate-releaser','owner');
    const limited=await addUser('read-only-worker','employee');
    const noMfa=await fixture.standaloneMakeSession(e.owner.id);
    const bank=encryptBankAccount('000000000001');
    await db.update(s.employees).set({bankCode:'BPI',bankAccount:bank}).where(eq(s.employees.id,e.worker.id));
    await db.insert(s.treasuryControlPolicies).values({organizationId:e.org.id,enabled:true,
      requireReleaseSubmitterSeparation:true,enabledAt:new Date(Date.now()-60000),
      createdByUserId:releaser.user.id,updatedByUserId:releaser.user.id});
    await db.insert(s.treasuryOperatorAssignments).values([e.owner.id,releaser.user.id].map(userId=>({
      organizationId:e.org.id,userId,active:true,createdByUserId:releaser.user.id})));
    const runs={};
    for(const[name,month]of [['normal','07'],['ambiguous','08'],['provider-changed','09']]){
      const[run]=await db.insert(s.payrollRuns).values({organizationId:e.org.id,legalEntityId:e.entity.id,
        scopeOrgUnitId:e.unit.id,periodLabel:e.marker+' '+name,
        periodStart:'2026-'+month+'-01',periodEnd:'2026-'+month+'-15',payDate:'2026-'+month+'-16',
        status:'Released',employeeCount:1,grossPay:'20000.00',netPay:'18000.00',
        processedChunks:1,totalChunks:1}).returning();
      const[entry]=await db.insert(s.payrollEntries).values({payrollRunId:run.id,employeeId:e.worker.id,
        grossPay:'20000.00',deductions:'2000.00',netPay:'18000.00',
        trace:{payment:{employeeName:e.worker.firstName+' '+e.worker.lastName,
          employeeNo:e.worker.employeeNo,bankAccount:bank,bankCode:'BPI',mobile:null}}}).returning();
      await db.insert(s.auditEvents).values({organizationId:e.org.id,actor:releaser.user.name,
        action:'Payroll released',resource:run.periodLabel,
        metadata:{runId:run.id,releasedByUserId:releaser.user.id,fictionalProof:true}});
      runs[name]={run,entry,referenceNumber:'PAY-'+run.id+'-'+e.worker.employeeNo,
        payoutId:'po-fictional-'+String(run.id).padStart(8,'0')};
    }
    return{...e,runs,releaser,limited,noMfaCookie:noMfa.cookie,port};
  }
  const a=await person('ATTA',3000),b=await person('ATTB',3001),victim=await person('VICTIM',3002);
  for(const key of ['org','entity','worker','owner'])assert.ok(victim[key].id>Math.max(a[key].id,b[key].id,6));
  for(const name of ['normal','ambiguous','provider-changed'])assert.ok(victim.runs[name].run.id>
    Math.max(a.runs[name].run.id,b.runs[name].run.id,6));
  mkdirSync('qa-artifacts',{recursive:true});
  writeFileSync('qa-artifacts/xendit-post-fixture.json',JSON.stringify({a,b,victim},null,2)+'\n',{mode:0o600});
  const envLines=[a,b,victim].flatMap((e,i)=>[
    'XENDIT_PROOF_ORG_'+i+'='+e.org.id,'XENDIT_PROOF_ENTITY_'+i+'='+e.entity.id]);
  writeFileSync('qa-artifacts/xendit-post-identities.env',envLines.join('\n')+'\n',{mode:0o600});
  console.log(JSON.stringify({kind:'fictional-xendit-post-seed',employers:10,attackerEmployers:2,
    higherIdVictim:true,treasurySeparationEnabled:true,providerCalls:0,coverageCredits:0}));
}finally{await pool.end();}
