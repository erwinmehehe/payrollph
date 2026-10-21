/**
 * Synthetic three-employer WFM GET/POST and unchanged victim DB witness.
 * Must run from disposable PostgreSQL16 CI only, never live payroll.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  attendanceExceptionEvents, workforceAttendanceLockPolicies,
  workforceAttendancePeriodLocks, users, sessions,
} from "../../src/db/schema";

export async function verifyWorkforceAttendanceSweep(f,{request,expectStatus}){
  if(process.env.CI!=="true"||process.env.TENANT_SECOND_PASS_MODE!=="isolated-ci-only"||
    !/^(postgresql:\/\/)([^/]+@)(127\.0\.0\.1|localhost):5432\/app_db$/.test(process.env.DATABASE_URL??"")){
    throw new Error("Attendance proof requires disposable localhost PostgreSQL16");
  }
  const day="2026-10-19",victim=f.orgs[0];
  const events=await db.insert(attendanceExceptionEvents).values(f.orgs.map((org,idx)=>({
    organizationId:org.id,
    employeeId:idx===0?f.victimEmployee.id:f.ownedEmployees[idx-1].id,
    workDate:day,exceptionKind:"missing_time_in",severity:"warning",
    message:"Fictional attendance discrepancy",
    fingerprintSha256:createHash("sha256").update("CI-ATTENDANCE-"+org.id).digest("hex"),
    status:"open",
    slaDueAt:new Date("2026-10-20T00:00:00.000Z"),
  }))).returning({id:attendanceExceptionEvents.id,organizationId:attendanceExceptionEvents.organizationId});
  await db.insert(workforceAttendanceLockPolicies).values({
    organizationId:victim.id,requirePayrollCutoffLock:true,
    updatedBy:"Fictional victim",
  }).onConflictDoNothing();
  await db.insert(workforceAttendancePeriodLocks).values({
    organizationId:victim.id,periodStart:"2026-10-01",periodEnd:"2026-10-15",
    lockType:"attendance",reason:"Fictional victim period",
    lockedBy:"Fictional victim",status:"locked",
  }).onConflictDoNothing();
  const victimEventsBefore=await db.select().from(attendanceExceptionEvents)
    .where(eq(attendanceExceptionEvents.organizationId,victim.id));
  const victimPoliciesBefore=await db.select().from(workforceAttendanceLockPolicies)
    .where(eq(workforceAttendanceLockPolicies.organizationId,victim.id));
  const victimLocksBefore=await db.select().from(workforceAttendancePeriodLocks)
    .where(eq(workforceAttendancePeriodLocks.organizationId,victim.id));
  assert.ok(victimEventsBefore.some(e=>e.id===events[0].id)&&victimLocksBefore.length>0);
  for(const idx of [1,2]){
    const org=f.orgs[idx],cookie=f.ownerSessions[idx].cookie;
    await db.update(users).set({totpEnabled:true}).where(eq(users.id,f.owners[idx].id));
    await db.update(sessions).set({mfaVerifiedAt:new Date()}).where(eq(sessions.id,f.ownerSessions[idx].id));
    const ownLockGet=expectStatus(await request("/api/workforce/attendance-locks?organizationId="+org.id,{cookie}),200,"Own employer lock policy loaded");
    assert.equal(ownLockGet.json?.organizationId,org.id);
    assert.ok(Array.isArray(ownLockGet.json?.locks));
    expectStatus(await request("/api/workforce/attendance-locks?organizationId="+victim.id,{cookie}),403,"Foreign employer lock policy denied");
    const ownLockPost=expectStatus(await request("/api/workforce/attendance-locks",{method:"POST",cookie,body:{organizationId:org.id,action:"set_policy",requirePayrollCutoffLock:true}}),200,"Own synthetic cutoff policy update");
    assert.equal(ownLockPost.json?.policy?.organizationId,org.id);
    expectStatus(await request("/api/workforce/attendance-locks",{method:"POST",cookie,body:{organizationId:victim.id,action:"set_policy",requirePayrollCutoffLock:false}}),403,"Foreign employer lock policy cannot be modified");
    const ownExceptionGet=expectStatus(await request("/api/workforce/attendance-exceptions?organizationId="+org.id+"&startDate="+day+"&endDate="+day+"&includeAll=1",{cookie}),200,"Own attendance analysis includes seeded worker");
    assert.equal(ownExceptionGet.json?.organizationId,org.id);
    assert.ok(ownExceptionGet.json?.days?.some(d=>d.employee?.id===f.ownedEmployees[idx-1].id));
    assert.ok(!ownExceptionGet.json?.days?.some(d=>d.employee?.id===f.victimEmployee.id));
    expectStatus(await request("/api/workforce/attendance-exceptions?organizationId="+victim.id+"&startDate="+day+"&endDate="+day+"&includeAll=1",{cookie}),403,"Foreign employer attendance analysis denied");
    const ownEventsGet=expectStatus(await request("/api/workforce/attendance-exception-events?organizationId="+org.id+"&startDate="+day+"&endDate="+day,{cookie}),200,"Own event queue exposes seeded event");
    assert.equal(ownEventsGet.json?.organizationId,org.id);
    assert.ok(ownEventsGet.json?.exceptions?.some(e=>e.id===events[idx].id));
    assert.ok(!ownEventsGet.json?.exceptions?.some(e=>e.id===events[0].id));
    expectStatus(await request("/api/workforce/attendance-exception-events?organizationId="+victim.id+"&startDate="+day+"&endDate="+day,{cookie}),403,"Foreign attendance event queue denied");
    const ownEventsPost=expectStatus(await request("/api/workforce/attendance-exception-events",{method:"POST",cookie,body:{organizationId:org.id,eventId:events[idx].id,action:"assign_owner",ownerUserId:f.owners[idx].id}}),200,"Own attendance exception assignment");
    assert.equal(ownEventsPost.json?.organizationId,org.id);
    assert.equal(ownEventsPost.json?.eventId,events[idx].id);
    expectStatus(await request("/api/workforce/attendance-exception-events",{method:"POST",cookie,body:{organizationId:victim.id,eventId:events[0].id,action:"assign_owner",ownerUserId:f.owners[idx].id}}),403,"Foreign employer attendance exception assignment denied");
  }
  const victimEventsAfter=await db.select().from(attendanceExceptionEvents)
    .where(eq(attendanceExceptionEvents.organizationId,victim.id));
  const victimPoliciesAfter=await db.select().from(workforceAttendanceLockPolicies)
    .where(eq(workforceAttendanceLockPolicies.organizationId,victim.id));
  const victimLocksAfter=await db.select().from(workforceAttendancePeriodLocks)
    .where(eq(workforceAttendancePeriodLocks.organizationId,victim.id));
  assert.deepEqual(victimEventsAfter,victimEventsBefore,"Foreign assignment must leave seeded victim exception unchanged");
  assert.deepEqual(victimPoliciesAfter,victimPoliciesBefore,"Foreign policy updates cannot change victim policy");
  assert.deepEqual(victimLocksAfter,victimLocksBefore,"Foreign cutoff updates cannot alter victim locks");
}
