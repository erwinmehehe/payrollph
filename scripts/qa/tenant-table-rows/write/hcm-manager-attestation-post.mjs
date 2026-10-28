import {eq} from 'drizzle-orm';
import {createRows as readRows} from '../read/hcm-manager-attestation.mjs';
export const fixtureOrder={};
export function createRows(context) {
 const {assert,db,addWorker,auditBusinessSnapshot}=context;
 let runtime;const schema=()=>runtime??=import('../../../../src/db/schema.ts');
 const state=async orgId=>{
  const s=await schema(),result={};
  for(const [key,table] of Object.entries({attestations:s.hcmEmploymentDecisionManagerAttestations,events:s.hcmEmploymentDecisionEvents,
   audits:s.auditEvents,decisions:s.hcmEmploymentTermDecisions,terms:s.hcmEmploymentTerms,positions:s.positions,assignments:s.positionAssignments,
   workers:s.employees,profiles:s.employeePayProfiles,payroll:s.payrollRuns,payouts:s.payoutBatches,memberships:s.userOrganizations}))
   result[key]=await db.select().from(table).where(eq(table.organizationId,orgId)).orderBy(table.id);
  result.audits=auditBusinessSnapshot(result.audits);return result;
 };
 const body=(c,recommendation='support')=>({organizationId:c.orgId,recommendation,statement:c.marker+' fictional manager evidence '+recommendation});
 const expect=(before,after,c,response,recommendation='support')=>{
  for(const key of Object.keys(before))if(!['attestations','events','audits'].includes(key))assert.deepEqual(after[key],before[key],key+' must not change');
  const added=key=>{assert.equal(after[key].length,before[key].length+1);const rows=after[key].filter(r=>!before[key].some(old=>old.id===r.id));assert.equal(rows.length,1);assert.deepEqual(after[key].filter(r=>r.id!==rows[0].id),before[key]);return rows[0];};
  const row=added('attestations');
  assert.equal(row.organizationId,c.orgId);assert.equal(row.decisionId,c.seeded.id);assert.equal(row.employeeId,c.seeded.workerId);
  assert.equal(row.managerEmployeeId,c.seeded.managerId);assert.equal(row.managerUserId,c.owner.id);assert.equal(row.managerName,c.owner.name);
  assert.equal(row.workerPositionAssignmentId,c.seeded.assignmentId);assert.equal(row.workerPositionId,c.seeded.positionId);
  assert.equal(row.recommendation,recommendation);assert.equal(row.statement,body(c,recommendation).statement);
  assert.deepEqual(row.reportingLineSnapshot,c.seeded.reportingLineSnapshot);
  assert.equal(response.status,201);assert.deepEqual(JSON.parse(JSON.stringify(response.json.attestation)),JSON.parse(JSON.stringify(row)));
  const event=added('events');assert.equal(event.organizationId,c.orgId);assert.equal(event.decisionId,c.seeded.id);
  assert.equal(event.employeeId,c.seeded.workerId);assert.equal(event.eventType,'manager_attested');assert.equal(event.actorName,c.owner.name);assert.equal(event.actorUserId,c.owner.id);
  assert.deepEqual(event.metadata,{managerAttestationId:row.id,managerEmployeeId:c.seeded.managerId,workerPositionAssignmentId:c.seeded.assignmentId,workerPositionId:c.seeded.positionId,recommendation});
  const audit=added('audits');assert.equal(audit.organizationId,c.orgId);assert.equal(audit.actor,c.owner.name);
  assert.equal(audit.action,'Employment decision manager attestation submitted');assert.equal(audit.resource,'Decision #'+c.seeded.id);
  assert.deepEqual(audit.metadata,{employeeId:c.seeded.workerId,managerAttestationId:row.id,recommendation,workerPositionAssignmentId:c.seeded.assignmentId});
 };
 return [
 { key: "POST hcm/employment-term-decisions/[id]/manager-attestation", pathIds: {id:'id'}, status: 201, deny: 403,
  seed:async e=>{
   const s=await schema(),seed=await readRows({assert,db,addWorker,rowTables:s})[0].seed(e);
   // A real owner account is also the employee currently named by the reporting
   // line. Company-wide HR access alone is deliberately insufficient below.
   await db.update(s.users).set({employeeId:seed.managerId}).where(eq(s.users.id,e.owner.id));
   return seed;
  }, state: state, ownBody: body, foreignBody: c=>({...body(c),organizationId:c.victim.org.id}),
  forged: {status:404,body:body}, expect: expect,
  exercise:async(c,{request,expectStatus,cookie})=>{
   const s=await schema(),url='/api/hcm/employment-term-decisions/'+c.seeded.id+'/manager-attestation';
   for(const recommendation of ['do_not_support','needs_more_review']){
    const before=await state(c.orgId),response=expectStatus(await request(url,{method:'POST',cookie,body:body(c,recommendation)}),201,'supported recommendation '+recommendation);
    expect(before,await state(c.orgId),c,response,recommendation);
   }
   const stable=await state(c.orgId),victimBefore=await state(c.victim.org.id);
   const deny=async(code,label)=>{
    const response=expectStatus(await request(url,{method:'POST',cookie,body:body(c)}),code,label);
    assert.deepEqual(await state(c.orgId),stable);assert.deepEqual(await state(c.victim.org.id),victimBefore);
    return response;
   };
   await db.update(s.hcmEmploymentTermDecisions).set({status:'cancelled'}).where(eq(s.hcmEmploymentTermDecisions.id,c.seeded.id));
   const sealed=await state(c.orgId);expectStatus(await request(url,{method:'POST',cookie,body:body(c)}),409,'sealed decision refused');assert.deepEqual(await state(c.orgId),sealed);
   await db.update(s.hcmEmploymentTermDecisions).set({status:'pending_approval'}).where(eq(s.hcmEmploymentTermDecisions.id,c.seeded.id));
   await db.update(s.users).set({employeeId:null}).where(eq(s.users.id,c.owner.id));await deny(403,'People admin without current-manager identity');
   await db.update(s.users).set({employeeId:c.seeded.managerId}).where(eq(s.users.id,c.owner.id));
   await db.update(s.positions).set({managerEmployeeId:c.workerId}).where(eq(s.positions.id,c.seeded.positionId));
   const changed=await state(c.orgId);expectStatus(await request(url,{method:'POST',cookie,body:body(c)}),403,'changed reporting line refused');assert.deepEqual(await state(c.orgId),changed);
   await db.update(s.positions).set({managerEmployeeId:c.seeded.managerId}).where(eq(s.positions.id,c.seeded.positionId));
   await db.update(s.sessions).set({mfaVerifiedAt:null}).where(eq(s.sessions.userId,c.owner.id));
   const mfa=await deny(403,'missing verified MFA');assert.equal(mfa.json.code,'MFA_REQUIRED');
   await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.userId,c.owner.id));
   assert.deepEqual(await state(c.orgId),stable);assert.deepEqual(await state(c.victim.org.id),victimBefore);
   return {recommendations:['support','do_not_support','needs_more_review'],sealedDecisionDenied:true,unassignedAdminDenied:true,changedManagerDenied:true,mfaDenied:true};
  },
 }];
}
