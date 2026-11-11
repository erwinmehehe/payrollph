import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

/** Exercise each authoritative source branch, not just attendance. No source
 * record is changed through Studio; only its owned review case may transition. */
export async function proveStudioSourceResolutions({db,s,orm,actors,all,origin}){
 const {eq}=orm,plain=x=>JSON.parse(JSON.stringify(x));let own=0,denials=0,discriminations=0;
 const types=['coverage_recovery','timesheet_escalation','missing_timesheet_escalation','attendance_resolution','payroll_readiness','statutory_followup'];
 const sourceTypes=['open_shift','workforce_timesheet','workforce_timesheet_expectation','attendance_exception','payroll_run','compliance_action_task'];
 async function seed(a){
  const [site]=await db.insert(s.worksites).values({organizationId:a.org.id,code:'SRC',name:a.marker+' site'}).returning();
  const [shift]=await db.insert(s.shiftDefinitions).values({organizationId:a.org.id,code:'SRC',name:a.marker+' shift',startTime:'09:00',endTime:'17:00'}).returning();
  const [coverage]=await db.insert(s.openShifts).values({organizationId:a.org.id,worksiteId:site.id,shiftDefinitionId:shift.id,workDate:'2026-10-15',status:'cancelled'}).returning();
  const [timesheet]=await db.insert(s.workforceTimesheets).values({organizationId:a.org.id,employeeId:a.worker.id,periodStart:'2026-10-01',periodEnd:'2026-10-15',status:'approved',snapshotHash:createHash('sha256').update(a.marker).digest('hex')}).returning();
  const [run]=await db.insert(s.payrollRuns).values({organizationId:a.org.id,legalEntityId:a.entity.id,periodLabel:a.marker+' inert historical fixture',periodStart:'2026-10-01',periodEnd:'2026-10-15',payDate:'2026-10-20',status:'Released'}).returning();
  const [missing]=await db.insert(s.workforceTimesheetExpectations).values({organizationId:a.org.id,payrollRunId:run.id,employeeId:a.worker.id,periodStart:'2026-10-01',periodEnd:'2026-10-15',expectedBy:'2026-10-15',status:'approved'}).returning();
  const [attendance]=await db.insert(s.attendanceExceptionEvents).values({organizationId:a.org.id,employeeId:a.worker.id,workDate:'2026-10-15',exceptionKind:'missing_punch',severity:'warning',message:a.marker+' fictional attendance',fingerprintSha256:createHash('sha256').update(a.marker+' attendance').digest('hex'),status:'resolved'}).returning();
  const [statutory]=await db.insert(s.complianceActionTasks).values({organizationId:a.org.id,sourceType:'statutory_remittance',sourceKey:randomUUID(),severity:'warning',title:a.marker+' fictional follow-up',detail:'Fictional source; never an agency submission',status:'resolved'}).returning();
  return [coverage,timesheet,missing,attendance,run,statutory];
 }
 const sources=new Map();for(const a of actors)sources.set(a.org.id,await seed(a));
 async function makeCase(a,index,sourceId,status='open'){
  const [row]=await db.insert(s.automationOperationalCases).values({organizationId:a.org.id,caseType:types[index],sourceType:sourceTypes[index],sourceId,
   employeeId:a.worker.id,ownerTeam:'Fictional operations',title:a.marker+' '+randomUUID(),detail:'Fictional review source fixture',status}).returning();return row;
 }
 async function post(a,c,transition,orgId=a.org.id){
  const r=await fetch(origin+'/api/automation-studio',{method:'POST',headers:{cookie:a.cookie,origin,'sec-fetch-site':'same-origin','content-type':'application/json'},
   body:JSON.stringify({organizationId:orgId,action:'triage-operational-case',caseId:c.id,transition,note:'Fictional source status independently inspected for this test.'}),signal:AbortSignal.timeout(30000)});
  const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=null;}return {status:r.status,text,json};
 }
 function prove(r,a,c,status,persisted){
  assert.equal(r.status,200);const row=r.json?.operationalCase;assert.ok(row);
  assert.equal(row.organizationId,a.org.id,"accepts another employer's data");assert.equal(row.id,c.id,"accepts another employer's data");
  assert.equal(row.caseType,c.caseType);assert.equal(row.sourceId,c.sourceId);assert.equal(row.status,status);assert.equal(r.json.sourceMutation,false);
  assert.deepEqual(row,persisted,'HTTP case must equal persisted own case');
 }
 async function deny(a,c,transition,status,orgId){
  const before=await all(),r=await post(a,c,transition,orgId);assert.equal(r.status,status);assert.equal(r.json?.operationalCase,undefined);
  for(const actor of actors)assert.ok(!r.text.includes(actor.marker),'foreign source marker disclosed');
  assert.deepEqual(await all(),before,'denial changed source/case/business/session/audit state');denials++;
 }
 const victim=actors.at(-1),victimCases=[];
 for(let i=0;i<types.length;i++)victimCases.push(await makeCase(victim,i,sources.get(victim.org.id)[i].id,'acknowledged'));
 for(const a of actors.slice(0,2))for(let i=0;i<types.length;i++){
  const c=await makeCase(a,i,sources.get(a.org.id)[i].id);
  for(const [transition,status]of [['acknowledge','acknowledged'],['resolve','resolved'],['reopen','open']]){
   const before=await all(),r=await post(a,c,transition),after=await all();
   const [persisted]=await db.select().from(s.automationOperationalCases).where(eq(s.automationOperationalCases.id,c.id));
   prove(r,a,c,status,plain(persisted));const index=actors.indexOf(a);
   for(let j=0;j<actors.length;j++)if(j!==index)assert.deepEqual(after[j],before[j],'own review changed another employer');
   for(const [table,rows]of Object.entries(before[index])){
    if(table==='automationOperationalCases'||table==='auditEvents')continue;
    assert.deepEqual(after[index][table],rows,'Studio changed authoritative '+table);
   }
   assert.equal(after[index].auditEvents.length,before[index].auditEvents.length+1);
   assert.deepEqual(after[index].auditEvents.slice(0,-1),before[index].auditEvents,'prior audits changed');
   assert.equal(after[index].automationOperationalCases.length,before[index].automationOperationalCases.length);
   assert.deepEqual(after[index].automationOperationalCases.filter(x=>x.id!==c.id),before[index].automationOperationalCases.filter(x=>x.id!==c.id),'another owned case changed');
   const forged=structuredClone(r);forged.json.operationalCase.organizationId=victim.org.id;
   assert.throws(()=>prove(forged,a,c,status,forged.json.operationalCase),/accepts another employer's data/,"case validator accepts another employer's data");discriminations++;own++;
  }
  await deny(a,victimCases[i],'resolve',404);
  await deny(a,victimCases[i],'resolve',403,victim.org.id);
  const forged=await makeCase(a,i,sources.get(victim.org.id)[i].id,'acknowledged');
  await deny(a,forged,'resolve',409);
 }
 assert.equal(own,36);assert.equal(denials,36);assert.equal(discriminations,36);
 return {families:types,own,denials,discriminations,authoritativeSourcesUnchanged:true};
}
