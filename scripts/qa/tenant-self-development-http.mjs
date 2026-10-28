import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ENDPOINT, METHODS, plain, requireDisposable, proveRead, proveProgress, proveMilestone } from './tenant-self-development-contract.mjs';

export async function run() {
  requireDisposable(); // Refuse before importing application code or opening PostgreSQL.
  const [{ db, pool }, s, table, { eq }, { auditBusinessSnapshot }] = await Promise.all([
    import('../../src/db/index.ts'), import('../../src/db/schema.ts'), import('./tenant-table-http.mjs'),
    import('drizzle-orm'), import('./tenant-table-invariants.mjs'),
  ]);
  const { seedEmployer, addWorker, standaloneMakeSession: session, standaloneRequest: request, standaloneExpectStatus: status } = table;
  const rows = async (tbl, orgId) => plain(await db.select().from(tbl).where(eq(tbl.organizationId, orgId)).orderBy(tbl.id));
  const snapshot = async orgId => {
    const result = {};
    for (const [key, tbl] of Object.entries({ plans:s.performanceSkillDevelopmentPlans, milestones:s.performanceSkillDevelopmentMilestones,
      progress:s.performanceSkillDevelopmentProgress, planEvents:s.performanceSkillDevelopmentPlanEvents, skills:s.hcmSkills,
      employees:s.employees, payProfiles:s.employeePayProfiles, payroll:s.payrollRuns, memberships:s.userOrganizations, audits:s.auditEvents })) result[key] = await rows(tbl, orgId);
    result.audits = auditBusinessSnapshot(result.audits); return result;
  };
  const nonce = randomUUID().replaceAll('-','').slice(0,10);
  async function seed(label) {
    const e = await seedEmployer(label, nonce, session);
    const [ess] = await db.insert(s.users).values({ name:e.marker+' fictional employee', email:(e.marker+'-development@example.invalid').toLowerCase(),
      role:'employee', employeeId:e.worker.id, localPasswordEnabled:false, passwordHash:'fictional-no-login', active:true }).returning();
    const [membership] = await db.insert(s.userOrganizations).values({ organizationId:e.org.id,userId:ess.id,role:'employee',workerEmployeeId:e.worker.id,active:true }).returning();
    const self = await session(ess.id), peer = await addWorker(e,'PEER');
    async function plan(suffix, worker=e.worker, visible=true, state='planned') {
      const [skill] = await db.insert(s.hcmSkills).values({ organizationId:e.org.id,code:(e.marker+suffix).slice(0,48),name:e.marker+suffix+' skill' }).returning();
      const [p] = await db.insert(s.performanceSkillDevelopmentPlans).values({ organizationId:e.org.id, employeeId:worker.id, skillId:skill.id,
        title:e.marker+suffix+' plan',objective:'Fictional learning evidence only',targetProficiency:'3.00',status:state,
        targetDate:'2099-12-'+({'-OPEN':'01','-HIDDEN':'02','-COMPLETE':'03','-CANCEL':'04','-PEER':'05'}[suffix]), employeeVisible:visible,
        createdByUserId:e.owner.id,createdByName:e.owner.name }).returning();
      const [m] = await db.insert(s.performanceSkillDevelopmentMilestones).values({organizationId:e.org.id,planId:p.id,title:e.marker+suffix+' milestone',dueDate:p.targetDate}).returning();
      await db.insert(s.performanceSkillDevelopmentProgress).values({organizationId:e.org.id,planId:p.id,employeeId:worker.id,
        authorUserId:e.owner.id,authorName:e.owner.name,content:e.marker+suffix+' historical progress',progressPercent:10*e.rank});
      return { ...p, milestone:m };
    }
    const open=await plan('-OPEN'), hidden=await plan('-HIDDEN',e.worker,false), completed=await plan('-COMPLETE',e.worker,true,'completed'), cancelled=await plan('-CANCEL',e.worker,true,'cancelled'), peerPlan=await plan('-PEER',peer);
    return {...e,ess,membership,selfCookie:self.cookie,open,hidden,completed,cancelled,peerPlan,milestone:open.milestone};
  }
  try {
    const {rows:[empty]}=await pool.query('SELECT count(*)::int AS n FROM organizations'); assert.equal(empty.n,0,'fresh empty disposable employer database required');
    const {rows:[engine]}=await pool.query('SHOW server_version_num');
    const a=await seed('ATTA'), b=await seed('ATTB'), victim=await seed('VICTIM');
    for(const field of ['org','worker','open','milestone']) assert.ok(victim[field].id>a[field].id && victim[field].id>b[field].id,'genuine higher-ID victim '+field);
    for(const actor of [a,b]) {
      const [forged]=await db.insert(s.users).values({name:actor.marker+' forged employee link',email:(actor.marker+'-forged@example.invalid').toLowerCase(),
        role:'employee',employeeId:victim.worker.id,localPasswordEnabled:false,passwordHash:'fictional-no-login',active:true}).returning();
      await db.insert(s.userOrganizations).values({organizationId:actor.org.id,userId:forged.id,role:'employee',active:true});
      actor.forgedCookie=(await session(forged.id)).cookie;
    }
    proveRead(status(await request(ENDPOINT,{cookie:victim.selfCookie}),200,'victim legitimate own positive'),await snapshot(victim.org.id),victim);
    const victimBefore=await snapshot(victim.org.id), coreBefore=await table.victimSnapshot(victim.org.id);
    let ownReads=0, progressProofs=0, milestoneProofs=0, denied=0; const first={};
    for(const actor of [a,b]) {
      const cookie=actor.selfCookie;
      const readBefore=await snapshot(actor.org.id), owned=status(await request(ENDPOINT,{cookie}),200,'own development read');
      proveRead(owned,readBefore,actor); ownReads++;
      if(first.read) assert.throws(()=>proveRead(first.read.response,first.read.before,actor),"GET proof accepts another employer's data");
      else first.read={response:owned,before:readBefore};
      assert.deepEqual(await snapshot(actor.org.id),readBefore);
      const ignored=status(await request(ENDPOINT+'?organizationId='+victim.org.id+'&employeeId='+victim.worker.id,{cookie}),200,'GET cookie identity ignores forged selector');
      proveRead(ignored,readBefore,actor); assert.deepEqual(ignored.json,owned.json);
      for(const percent of [25*actor.rank,null]) {
        const content=actor.marker+' verified fictional progress '+String(percent), before=await snapshot(actor.org.id);
        const own=status(await request(ENDPOINT,{method:'POST',cookie,body:{planId:actor.open.id,content,progressPercent:percent,
          organizationId:victim.org.id,employeeId:victim.worker.id,authorUserId:victim.ess.id}}),201,'own progress is session-bound');
        const after=await snapshot(actor.org.id); proveProgress(before,after,actor,own,content,percent); progressProofs++;
        if(!first.post) first.post={before,after,response:own,content,percent};
        else if(actor===b) assert.throws(()=>proveProgress(first.post.before,first.post.after,actor,first.post.response,first.post.content,first.post.percent),"POST proof accepts another employer's data");
      }
      for(const next of ['in_progress','completed']) {
        const before=await snapshot(actor.org.id), own=status(await request(ENDPOINT,{method:'PATCH',cookie,body:{milestoneId:actor.milestone.id,status:next}}),200,'own milestone '+next);
        const after=await snapshot(actor.org.id); proveMilestone(before,after,actor,own,next); milestoneProofs++;
        if(!first.patch) first.patch={before,after,response:own,next};
        else if(actor===b) assert.throws(()=>proveMilestone(first.patch.before,first.patch.after,actor,first.patch.response,first.patch.next),"PATCH proof accepts another employer's data");
      }
      async function deny(method,body,expected,reason,auth=cookie) {
        const before=await snapshot(actor.org.id), foreignBefore=await snapshot(victim.org.id);
        const response=status(await request(ENDPOINT,{method,cookie:auth,body}),expected,reason);
        assert.ok(!response.text.includes(victim.marker)); assert.ok(!response.text.includes(actor.peerPlan.title));
        assert.deepEqual(await snapshot(actor.org.id),before,'denial must not change attacker');
        assert.deepEqual(await snapshot(victim.org.id),foreignBefore,'denial must not change victim'); denied++;
      }
      for(const [p,code] of [[victim.open,404],[actor.peerPlan,404],[actor.hidden,404],[actor.completed,409],[actor.cancelled,409]]) {
        await deny('POST',{planId:p.id,content:'Valid fictional denied progress',progressPercent:50},code,'progress boundary');
        await deny('PATCH',{milestoneId:p.milestone.id,status:'in_progress'},code,'milestone boundary');
      }
      await deny('PATCH',{milestoneId:actor.milestone.id,status:'in_progress'},409,'completed milestone cannot reopen');
      await deny('POST',{planId:actor.open.id,content:'Valid fictional note',progressPercent:101},400,'invalid progress');
      for(const method of ['GET','POST','PATCH']) {
        const body=method==='GET'?undefined:method==='POST'?{planId:actor.open.id,content:'Valid fictional note'}:{milestoneId:actor.milestone.id,status:'in_progress'};
        await deny(method,body,401,'anonymous',null);
      }
      for(const method of ['GET','POST','PATCH']) await deny(method,method==='GET'?undefined:method==='POST'?{planId:actor.open.id,content:'Valid fictional note'}:{milestoneId:actor.milestone.id,status:'in_progress'},403,'owner cannot impersonate employee',actor.cookie);
      for(const method of ['GET','POST','PATCH']) await deny(method,method==='GET'?undefined:method==='POST'?{planId:victim.open.id,content:'Valid fictional note'}:{milestoneId:victim.milestone.id,status:'in_progress'},403,'foreign employee link without victim membership',actor.forgedCookie);
      await db.update(s.userOrganizations).set({active:false}).where(eq(s.userOrganizations.id,actor.membership.id));
      for(const method of ['GET','POST','PATCH']) await deny(method,method==='GET'?undefined:method==='POST'?{planId:actor.open.id,content:'Valid fictional note'}:{milestoneId:actor.milestone.id,status:'in_progress'},403,'revoked employee membership');
      await db.update(s.userOrganizations).set({active:true}).where(eq(s.userOrganizations.id,actor.membership.id));
    }
    assert.deepEqual(await snapshot(victim.org.id),victimBefore,'victim target tables and audit unchanged');
    assert.deepEqual(await table.victimSnapshot(victim.org.id),coreBefore,'victim core tables unchanged');
    assert.equal(ownReads,2); assert.equal(progressProofs,4); assert.equal(milestoneProofs,4);
    console.log(JSON.stringify({kind:'self-development-tenant-http',methods:METHODS,ownReads,progressProofs,milestoneProofs,denied,
      discriminatingMethods:3,victimDatabaseUnchanged:true,coverageCredits:0,productionTested:false,certified:false,serverVersionNum:Number(engine.server_version_num)}));
  } finally { await pool.end(); }
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/tenant-self-development-http.mjs')) run().catch(error=>{console.error(error);process.exitCode=1;});
