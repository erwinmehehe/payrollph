/**
 * Five-fictional-worker attendance -> payroll development smoke.
 *
 * Runs ONLY in GitHub Actions against an EMPTY disposable loopback PG database.
 * This does NOT certify real device punches, employers, payroll amounts, releases
 * or actual human UAT. Historical payroll punches are explicitly synthetic.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import {
  employeeWorksiteAssignments, employees, orgUnits, organizations, payrollRuns,
  separationRecords, timePunches, userOrganizations, users, worksites,
} from "../../src/db/schema";
import { hashPassword } from "../../src/lib/crypto";
import { buildEmployeeTimesheetSnapshot } from "../../src/lib/workforce-timesheet-server";

const BASE = "http://127.0.0.1:3000";
const PERIOD_START = "2026-09-16";
const PERIOD_END = "2026-09-30";
const WORK_DATE = "2026-09-17";
const REST_DATE = "2026-09-18";
const QA_PASSWORD = "Synthetic!Qa1-" + randomUUID().replaceAll("-", "").slice(0, 22);
const report: Record<string, any> = {
  result: "NOT_RUN",
  sourceSha: process.env.GITHUB_SHA ?? "unknown",
  test: "wfm-five-worker-dev-acceptance",
  environment: "GitHub Actions disposable PostgreSQL 16 / localhost",
  attendanceSource: "seeded fictional historical punches; one separate current-day API clock smoke",
  independentHumanUat: "NOT_RUN",
  realEmployerPayrollReconciliation: "NOT_RUN",
  realDeviceCertification: "NOT_RUN",
  payrollRelease: "NOT_PERFORMED",
  payoutCalls: 0,
  governmentSubmission: "NOT_PERFORMED",
  checks: [],
  workers: [],
};

class Client {
  cookie = "";
  async json(path: string, method = "GET", payload?: unknown, extraHeaders?: Record<string, string>) {
    const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== "GET") headers.origin = BASE;
    if (payload !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(BASE + path, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      redirect: "manual",
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return { response, data: await response.json().catch(() => ({})) as Record<string, any> };
  }
}
async function ok(client: Client, path: string, method = "GET", payload?: unknown, extraHeaders?: Record<string,string>) {
  const result = await client.json(path, method, payload, extraHeaders);
  assert.ok(result.response.ok,
    method + " " + path + " failed with HTTP " + result.response.status +
    " / " + JSON.stringify(result.data).slice(0, 650));
  return result.data;
}
async function signIn(email: string) {
  const client = new Client();
  await ok(client, "/api/auth/login", "POST", { email, password: QA_PASSWORD });
  assert.ok(client.cookie, "Synthetic account has no authenticated session");
  return client;
}
function evidence(name: string) { report.checks.push(name); }
function guardTarget() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Never run local/manual or hosted app against mutable data");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.QA_URL, BASE);
  assert.equal(process.env.DEMO_MODE, "false");
  assert.equal(process.env.SETUP_TOKEN?.length! > 8, true, "Isolated synthetic setup token missing");
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(dbUrl.hostname, "127.0.0.1");
  assert.equal(dbUrl.port, "5432");
  assert.equal(dbUrl.pathname, "/app_db");
  for (const key of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_PAYOUTS_LIVE_APPROVED", "WFM_PUNCH_EVIDENCE_ENABLED",
    "WFM_GEOFENCE_PILOT_ENABLED",
  ]) assert.notEqual(process.env[key], "true", key + " must be OFF");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.equal(process.env.REQUIRE_PRIVILEGED_MFA, "false",
    "Disposable CI uses synthetic actors; do not carry this setting into an employer deployment");
}

async function run() {
  guardTarget();
  const existing = await db.select({id: organizations.id}).from(organizations).limit(1);
  assert.equal(existing.length, 0, "Refusing to modify non-empty database");

  const bootstrap = new Client();
  const established = await ok(bootstrap, "/api/setup", "POST", {
    companyName: "Fictional WFM Acceptance A",
    legalName: "Fictional WFM Acceptance A Inc.",
    name: "QA Organization Owner", email: "owner.wfm5@linaw.test", password: QA_PASSWORD,
  }, { "x-setup-token": process.env.SETUP_TOKEN! });
  const organizationId = Number(established.organizationId);
  assert.ok(organizationId > 0);
  const owner = await signIn("owner.wfm5@linaw.test");
  evidence("tenant-A-owner-setup-through-API");

  const cases = [
    { tag: "A1", kind: "normal-day", lastName: "Normal", expected: 480 },
    { tag: "A2", kind: "overnight", lastName: "Overnight", expected: 420 },
    { tag: "A3", kind: "approved-overtime", lastName: "Overtime", expected: 540 },
    { tag: "A4", kind: "incomplete-punch-corrected", lastName: "Correction", expected: 480 },
    { tag: "A5", kind: "worked-rest-day", lastName: "Restday", expected: 960 },
  ];
  const staff: Array<{id:number; tag:string; kind:string; expected:number}> = [];
  for (const [index, item] of cases.entries()) {
    const created = await ok(owner, "/api/employees", "POST", {
      organizationId,
      employeeNo: "WFM5-" + String(index + 1).padStart(3, "0"),
      firstName: "Fictional", lastName: item.lastName,
      email: "worker" + (index+1) + ".wfm5@linaw.test",
      title: "Synthetic Operations Associate",
      payBasis: "monthly", rateAmount: 30000 + index * 1000,
      standardWorkDaysPerMonth: 22, standardHoursPerDay: 8,
      region: "NCR", startDate: "2026-01-01",
      mobile: "QA-MOBILE-00" + (index + 1),
      bankAccount: "NONREAL" + String(index + 1).padStart(6, "0"),
      bankCode: "BDO", tinBranchCode: "0000",
    });
    const id = Number(created.employee?.id);
    assert.ok(id > 0, "Employee creation did not return the authoritative worker");
    staff.push({ id, tag: item.tag, kind: item.kind, expected: item.expected });
  }
  const listed = await ok(owner, "/api/employees?organizationId=" + organizationId);
  assert.equal((listed as any[]).length, 5, "Tenant A directory must contain precisely five fictional employees");
  evidence("five-employee-authoritative-directory");
  // A real manager is never company-wide without an active organizational unit.
  // Scope this fictional manager to the same active department as all five workers.
  const [qaUnit] = await db.insert(orgUnits).values({
    organizationId, type:"department", code:"WFM5-UNIT",
    name:"Fictional WFM QA Department",
  }).returning();
  await db.update(employees).set({ orgUnitId: qaUnit.id })
    .where(eq(employees.organizationId, organizationId));

  const [tenantB] = await db.insert(organizations).values({
    name: "Fictional WFM Acceptance B", legalName: "Fictional WFM Acceptance B Inc.", plan: "Core",
  }).returning();
  await db.insert(employees).values({
    organizationId: tenantB.id, employeeNo: "SENTINEL-B",
    firstName: "Fictional", lastName: "TenantB",
    title: "Isolation Sentinel", avatarInitials: "FS", basicRate: "30000",
    startDate: "2026-01-01",
  });
  const roleSpec = [
    { key: "manager", role: "manager" },
    { key: "hr", role: "hr" },
    { key: "payroll", role: "payroll" },
    { key: "tenantB", role: "owner" },
    ...staff.map((_,index) => ({ key: "employee" + index, role: "employee" })),
  ];
  const roleUsers = await db.insert(users).values(roleSpec.map((item, index) => ({
    name: "Fictional " + item.key,
    email: item.key.toLowerCase() + ".wfm5@linaw.test",
    passwordHash: hashPassword(QA_PASSWORD),
    role: item.role,
    employeeId: item.role === "employee" ? staff[index - 4].id : null,
    totpEnabled: false, backupCodes: [],
  }))).returning();
  await db.insert(userOrganizations).values(roleUsers.map((user,index) => ({
    userId: user.id,
    organizationId: index === 3 ? tenantB.id : organizationId,
    role: roleSpec[index].role,
    orgUnitId: roleSpec[index].role === "manager" ? qaUnit.id : null,
  })));
  const actors: Record<string, Client> = {};
  for (const item of roleSpec) actors[item.key] = await signIn(item.key.toLowerCase() + ".wfm5@linaw.test");
  evidence("distinct-synthetic-manager-hr-payroll-employee-and-tenant-B-logins");

  const denyTenant = await actors.tenantB.json(
    "/api/workforce/team-roster?organizationId=" + organizationId + "&startDate=2026-09-14&page=1");
  assert.equal(denyTenant.response.status, 403, "Tenant B must not inspect tenant A roster");
  const denyA = await owner.json(
    "/api/workforce/team-roster?organizationId=" + tenantB.id + "&startDate=2026-09-14&page=1");
  assert.equal(denyA.response.status, 403, "Tenant A must not inspect tenant B roster");
  evidence("two-way-tenant-roster-isolation-denied-at-server");

  const createShift = async (code:string,startTime:string,endTime:string) => {
    const created = await ok(owner, "/api/workforce/schedules", "POST", {
      organizationId, action: "create_shift",
      code, name: code, startTime, endTime, breakMinutes: 60,
    });
    assert.ok(Number(created.shift?.id) > 0);
    return Number(created.shift.id);
  };
  const dayShift = await createShift("WFM5-DAY", "09:00", "18:00");
  const nightShift = await createShift("WFM5-NIGHT", "22:00", "06:00");
  const createPattern = async (code:string, shiftId:number) => {
    const created = await ok(owner, "/api/workforce/schedules", "POST", {
      organizationId, action: "create_pattern", code, name: code,
      cycleDays: 3,
      days: [
        {isRestDay:true,label:"Rest"},
        {isRestDay:false,label:"Working shift",segments:[{shiftDefinitionId:shiftId}]},
        {isRestDay:true,label:"Rest"},
      ],
    });
    assert.ok(Number(created.pattern?.id) > 0);
    return Number(created.pattern.id);
  };
  const dayPattern = await createPattern("WFM5-DAY-PATTERN", dayShift);
  const nightPattern = await createPattern("WFM5-NIGHT-PATTERN", nightShift);
  for (const [index, worker] of staff.entries()) {
    const assigned = await ok(owner, "/api/workforce/schedules", "POST", {
      organizationId, action: "assign_schedule", employeeId: worker.id,
      patternId: index === 1 ? nightPattern : dayPattern,
      effectiveFrom: PERIOD_START, effectiveUntil: REST_DATE, anchorDate: PERIOD_START,
      reason: "Fictional five-worker development QA only",
    });
    assert.ok(Number(assigned.assignment?.id) > 0);
  }
  const roster = await ok(owner,
    "/api/workforce/team-roster?organizationId=" + organizationId + "&startDate=2026-09-14&page=1");
  assert.equal(Number(roster.totalEmployees), 5);
  assert.equal(roster.rows?.length, 5);
  assert.deepEqual(
    new Set(roster.rows.map((entry:any) => Number(entry.employee?.id))),
    new Set(staff.map(entry => entry.id)),
  );
  evidence("authenticated-seven-day-roster-five-matching-worker-identities");

  const ph = (day:string,time:string) => new Date(day + "T" + time + ":00+08:00");
  const punches = await db.insert(timePunches).values([
    { organizationId, employeeId:staff[0].id, workDate:WORK_DATE,
      timeIn:ph(WORK_DATE,"09:00"),timeOut:ph(WORK_DATE,"18:00"),
      breakStart:ph(WORK_DATE,"12:00"),breakEnd:ph(WORK_DATE,"13:00"),
      shiftStart:"09:00",shiftEnd:"18:00",status:"Complete",source:"wfm5-synthetic-history" },
    { organizationId, employeeId:staff[1].id, workDate:WORK_DATE,
      timeIn:ph(WORK_DATE,"22:00"),timeOut:ph(REST_DATE,"06:00"),
      breakStart:ph(REST_DATE,"02:00"),breakEnd:ph(REST_DATE,"03:00"),
      shiftStart:"22:00",shiftEnd:"06:00",status:"Complete",source:"wfm5-synthetic-history" },
    { organizationId, employeeId:staff[2].id, workDate:WORK_DATE,
      timeIn:ph(WORK_DATE,"09:00"),timeOut:ph(WORK_DATE,"19:00"),
      breakStart:ph(WORK_DATE,"12:00"),breakEnd:ph(WORK_DATE,"13:00"),
      shiftStart:"09:00",shiftEnd:"18:00",status:"Complete",source:"wfm5-synthetic-history" },
    { organizationId, employeeId:staff[3].id, workDate:WORK_DATE,
      timeIn:ph(WORK_DATE,"09:00"),timeOut:null,
      breakStart:ph(WORK_DATE,"12:00"),breakEnd:ph(WORK_DATE,"13:00"),
      shiftStart:"09:00",shiftEnd:"18:00",status:"Incomplete",source:"wfm5-synthetic-history" },
    { organizationId, employeeId:staff[4].id, workDate:WORK_DATE,
      timeIn:ph(WORK_DATE,"09:00"),timeOut:ph(WORK_DATE,"18:00"),
      breakStart:ph(WORK_DATE,"12:00"),breakEnd:ph(WORK_DATE,"13:00"),
      shiftStart:"09:00",shiftEnd:"18:00",status:"Complete",source:"wfm5-synthetic-history" },
    { organizationId, employeeId:staff[4].id, workDate:REST_DATE,
      timeIn:ph(REST_DATE,"09:00"),timeOut:ph(REST_DATE,"18:00"),
      breakStart:ph(REST_DATE,"12:00"),breakEnd:ph(REST_DATE,"13:00"),
      shiftStart:"09:00",shiftEnd:"18:00",status:"Complete",source:"wfm5-synthetic-history" },
  ]).returning();
  assert.equal(punches.length,6);
  const incomplete = punches.find(punch=>punch.employeeId === staff[3].id);
  assert.ok(incomplete?.id && incomplete.timeOut === null);
  const pendingSnapshot = await buildEmployeeTimesheetSnapshot({
    organizationId, employeeId:staff[3].id, periodStart:PERIOD_START,periodEnd:PERIOD_END,
  });
  assert.ok(pendingSnapshot.blockerCount > 0,"Incomplete punch must block approval");
  assert.equal(pendingSnapshot.workedMinutes,0,"Incomplete punch must not invent worked minutes");
  evidence("historical-fictional-punches-including-incomplete-night-overtime-rest");

  const otRequest = await ok(owner, "/api/workforce/overtime", "POST", {
    organizationId, action:"create_request",employeeId:staff[2].id,
    workDate:WORK_DATE,requestedMinutes:60,requestKind:"pre_approved",
    reason:"Synthetic one-hour overtime authorization",
  });
  const otId = Number(otRequest.request?.id);
  assert.ok(otId > 0);
  const otDecision = await ok(actors.manager, "/api/workforce/overtime", "POST", {
    organizationId,action:"decide_request",requestId:otId,
    decision:"approved",decisionNote:"Distinct fictional manager authorized one hour",
  });
  assert.equal(otDecision.request?.status ?? otDecision.requests?.[0]?.status,"approved");
  evidence("sixty-minute-overtime-request-independently-authorized");

  const correction = await ok(actors.employee3, "/api/self/workforce", "POST", {
    action:"request_correction",punchId:incomplete!.id,
    proposedTimeOut:"2026-09-17T18:00:00+08:00",
    reason:"Synthetic missing clock-out reconstructed for manager review",
  });
  assert.ok(Number(correction.correction?.id)>0);
  const deniedOwnDecision = await actors.employee3.json("/api/workforce/attendance-corrections","POST",{
    organizationId,action:"decide_request",requestId:correction.correction.id,decision:"approved",
  });
  assert.equal(deniedOwnDecision.response.status,403);
  const prematureLock = await actors.hr.json("/api/workforce/attendance-locks","POST",{
    organizationId,action:"lock_period",periodStart:PERIOD_START,periodEnd:PERIOD_END,
    lockType:"payroll_cutoff",reason:"Synthetic pre-correction denial check",
  });
  assert.equal(prematureLock.response.status,409);
  assert.equal(prematureLock.data.code,"ATTENDANCE_CORRECTIONS_PENDING");
  const approvedCorrection = await ok(actors.manager, "/api/workforce/attendance-corrections","POST",{
    organizationId,action:"decide_request",requestId:correction.correction.id,
    decision:"approved",decisionNote:"Distinct fictional reviewer verified omitted time-out",
  });
  assert.equal(approvedCorrection.punch?.status,"Corrected");
  evidence("missing-punch-blocked-until-independent-correction-and-lock-denial");

  const allSnapshots = [];
  for (const worker of staff) {
    const snapshot = await buildEmployeeTimesheetSnapshot({
      organizationId,employeeId:worker.id,periodStart:PERIOD_START,periodEnd:PERIOD_END,
    });
    assert.equal(snapshot.blockerCount,0,worker.tag+" unresolved attendance/OT blockers");
    assert.equal(snapshot.workedMinutes,worker.expected,
      worker.tag+" historical synthetic worked minutes differ from fixture");
    allSnapshots.push(snapshot);
  }
  await ok(owner, "/api/workforce/timesheets", "POST", {
    organizationId,action:"update_policy",active:true,enforcementMode:"block",
  });
  const payrollUser=actors.payroll;
  const preApprovals = await payrollUser.json("/api/payroll-runs","POST",{
    organizationId,periodStart:PERIOD_START,periodEnd:PERIOD_END,
    payDate:"2026-10-05",processNow:true,
  });
  assert.equal(preApprovals.response.status,422);
  assert.equal(preApprovals.data.code,"TIMESHEET_APPROVAL_REQUIRED");
  evidence("payroll-processing-denied-until-all-five-timecards-approved");

  const decisions: Record<string,number> = {};
  for (const [index,worker] of staff.entries()) {
    const submitter = index === 4 ? actors.manager : actors["employee"+index];
    const submitted = await ok(submitter,"/api/workforce/timesheets","POST",{
      organizationId,action:"submit",employeeId:worker.id,
      periodStart:PERIOD_START,periodEnd:PERIOD_END,
    });
    const timesheetId=Number(submitted.timesheet?.id);
    assert.ok(timesheetId>0);
    if(index===4){
      const refused=await actors.manager.json("/api/workforce/timesheets","POST",{
        organizationId,action:"decide",timesheetId,decision:"approved",
      });
      assert.equal(refused.response.status,409,"Manager cannot approve own submitted version");
    }
    const reviewer=index<3?actors.manager:actors.hr;
    const result=await ok(reviewer,"/api/workforce/timesheets","POST",{
      organizationId,action:"decide",timesheetId,decision:"approved",
      decisionNote:"Synthetic independent role decision; not human employer signoff",
    });
    assert.equal(result.timesheet?.status,"approved");
    const submittedBy=Number(result.timesheet?.submittedByUserId);
    const decidedBy=Number(result.timesheet?.decidedByUserId);
    assert.ok(submittedBy>0 && decidedBy>0 && submittedBy!==decidedBy);
    decisions[worker.tag]=decidedBy;
    report.workers.push({tag:worker.tag,scenario:worker.kind,expectedWorkedMinutes:worker.expected,
      observedTimesheetWorkedMinutes:allSnapshots[index].workedMinutes,
      timesheetStatus:"approved",reviewerRole:index<3?"manager":"hr"});
  }
  assert.equal(new Set(Object.values(decisions)).size,2,"Two separate timesheet reviewers required");
  evidence("two-distinct-reviewers-finish-five-timesheets-and-self-approval-is-denied");

  await ok(actors.hr,"/api/workforce/attendance-locks","POST",{
    organizationId,action:"set_policy",requirePayrollCutoffLock:true,
  });
  const noCutoff = await payrollUser.json("/api/payroll-runs","POST",{
    organizationId,periodStart:PERIOD_START,periodEnd:PERIOD_END,
    payDate:"2026-10-05",processNow:true,
  });
  assert.equal(noCutoff.response.status,422);
  assert.equal(noCutoff.data.code,"ATTENDANCE_CUTOFF_LOCK_REQUIRED");
  const locked=await ok(actors.hr,"/api/workforce/attendance-locks","POST",{
    organizationId,action:"lock_period",periodStart:PERIOD_START,periodEnd:PERIOD_END,
    lockType:"payroll_cutoff",reason:"Fictional five-worker payroll preview only",
  });
  assert.equal(locked.lock?.status,"locked");
  const deniedLock = await actors.employee0.json("/api/workforce/attendance-locks","POST",{
    organizationId,action:"unlock_period",lockId:locked.lock.id,unlockReason:"unauthorized",
  });
  assert.equal(deniedLock.response.status,403);
  evidence("cutoff-required-and-locked-with-employee-unlock-denied");

  const prepared=await ok(payrollUser,"/api/payroll-runs","POST",{
    organizationId,periodStart:PERIOD_START,periodEnd:PERIOD_END,
    payDate:"2026-10-05",processNow:true,
  });
  const runId=Number(prepared.run?.id);
  assert.ok(runId>0,"Preview requires a calculated synthetic run");
  assert.notEqual(prepared.run?.status,"Released");
  const register=await ok(payrollUser,"/api/payroll-runs?runId="+runId+"&include=entries");
  assert.equal(register.entries?.length,5,"Calculated preview must include each tenant-A worker exactly once");
  const uniqueEntries=new Set(register.entries.map((entry:any)=>Number(entry.employeeId)));
  assert.deepEqual(uniqueEntries,new Set(staff.map(worker=>worker.id)));
  let observedTotal=0;
  for (const [index,worker] of staff.entries()) {
    const entry=register.entries.find((row:any)=>Number(row.employeeId)===worker.id);
    assert.ok(entry && Number(entry.grossPay)>0,worker.tag+" must have a numeric synthetic gross preview");
    const trace=entry.trace as Record<string,any>;
    assert.equal(trace?.workforceSchedule?.mode,"advanced-with-legacy-fallback");
    assert.equal(trace?.payableTime?.mode,"calendar-segmented");
    const segments=trace.payableTime?.segments??[];
    const actual=segments.reduce((sum:number,segment:any)=>sum+Number(segment.minutes),0);
    assert.equal(actual,worker.expected,worker.tag+" payroll payable-time minutes");
    observedTotal+=actual;
    const premiumBlockers=(trace.flags??[]).filter((flag:string)=>
      String(flag).includes("WFM_PREMIUM_ALLOCATION_UNVERIFIED"));
    assert.deepEqual(premiumBlockers,[],worker.tag+" cannot price ambiguous wage boundaries");
    if(index===1){
      assert.equal(segments.filter((s:any)=>s.night).reduce((sum:number,s:any)=>sum+s.minutes,0),420);
      assert.deepEqual(new Set(segments.map((s:any)=>s.calendarDate)),
        new Set([WORK_DATE,REST_DATE]));
    }
    if(index===2){
      assert.equal(segments.filter((s:any)=>s.overtime).reduce((sum:number,s:any)=>sum+s.minutes,0),60);
    }
    if(index===4){
      assert.equal(segments.filter((s:any)=>s.restDay&&s.calendarDate===REST_DATE)
        .reduce((sum:number,s:any)=>sum+s.minutes,0),480);
    }
    report.workers[index].payrollWorkedMinutes=actual;
    report.workers[index].payrollHasTrace=true;
  }
  assert.equal(observedTotal,2880);
  const persisted=await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.id,runId),eq(payrollRuns.organizationId,organizationId),
  )).limit(1);
  assert.equal(persisted.length,1);
  assert.notEqual(persisted[0].status,"Released");
  const crossTenantPayroll=await actors.tenantB.json("/api/payroll-runs?runId="+runId+"&include=entries");
  assert.ok([403,404].includes(crossTenantPayroll.response.status),
    "Tenant B cannot read A payroll entries");
  const releaseReview=await ok(payrollUser,"/api/payroll-runs/"+runId+"/release-checklist");
  assert.equal(releaseReview.ready,false,"Unapproved payroll may not be released");
  evidence("five-worker-source-linked-calculated-preview-night-ot-rest-and-tenant-denial");
  evidence("no-payroll-checker-approval-no-release-no-payout");

  // Real current-day Web Bundy API smoke is separate from seeded historical pay punches.
  const liveIn=await ok(actors.employee0,"/api/web-bundy","POST",{
    organizationId,employeeId:staff[4].id,actionType:"clock_in",
  });
  assert.equal(Number(liveIn.punch?.employeeId),staff[0].id);
  const duplicateIn=await actors.employee0.json("/api/web-bundy","POST",{
    organizationId,actionType:"clock_in",
  });
  assert.equal(duplicateIn.response.status,409);
  const liveOut=await ok(actors.employee0,"/api/web-bundy","POST",{
    organizationId,actionType:"clock_out",
  });
  assert.equal(Number(liveOut.punch?.id),Number(liveIn.punch?.id));
  assert.equal(liveOut.punch?.status,"Complete");
  evidence("current-day-Web-Bundy-employee-self-binding-and-duplicate-in-denial");

  // Issue #1113: authenticated read acceptance on this EMPTY disposable PG16,
  // never on the repaired Neon branch or a hosted employer deployment.
  // Exercise the former missing-column paths with genuine persisted fictional
  // records. These are reads only: no final-pay computation or release.
  const [ownWorksite] = await db.insert(worksites).values({
    organizationId, code: "ISS1113-A", name: "Fictional Test Worksite A",
    orgUnitId: qaUnit.id,
  }).returning();
  const [assignment] = await db.insert(employeeWorksiteAssignments).values({
    organizationId, employeeId: staff[0].id, worksiteId: ownWorksite.id,
    decision: "allow", effectiveFrom: "2026-01-01",
    reason: "Synthetic Live Floor schema read proof only", createdBy: "CI fictional fixture",
  }).returning();
  assert.equal(assignment.decision, "allow", "the repaired decision column must persist");

  const [victimEmployee] = await db.select({
    id: employees.id, employeeNo: employees.employeeNo,
  }).from(employees).where(eq(employees.organizationId, tenantB.id));
  assert.ok(victimEmployee?.id, "fictional employer B must have a genuine worker");
  const [ownSeparation] = await db.insert(separationRecords).values({
    organizationId, employeeId: staff[4].id,
    separationType: "resignation", noticeDate: "2026-10-01", lastDay: "2026-12-31",
  }).returning();
  const [victimSeparation] = await db.insert(separationRecords).values({
    organizationId: tenantB.id, employeeId: victimEmployee.id,
    separationType: "resignation", noticeDate: "2026-10-01", lastDay: "2026-12-31",
  }).returning();
  assert.equal(ownSeparation.status, "draft");
  assert.equal(victimSeparation.status, "draft");
  const originalSeparationRows = await db.select().from(separationRecords);
  const originalWorksiteRows = await db.select().from(employeeWorksiteAssignments);
  const floorPath = (orgId: number) => "/api/workforce/live-floor?organizationId=" + orgId + "&page=1";
  const separationPath = (orgId: number) => "/api/separation?organizationId=" + orgId;

  const ownFloor = await ok(owner, floorPath(organizationId));
  assert.equal(ownFloor.totalEmployees, 5);
  assert.equal(ownFloor.scope, "company");
  assert.equal(ownFloor.page, 1);
  assert.equal(ownFloor.pageSize, 25);
  assert.equal(ownFloor.hasMore, false);
  assert.equal(JSON.stringify(ownFloor).includes(victimEmployee.employeeNo), false,
    "employer B worker must not leak into A Live Floor");
  const managerFloor = await ok(actors.manager, floorPath(organizationId));
  assert.equal(managerFloor.scope, "organization_unit",
    "manager Live Floor must stay scoped to their own unit");
  assert.equal(managerFloor.totalEmployees, 5);
  const ownFloorB = await ok(actors.tenantB, floorPath(tenantB.id));
  assert.equal(ownFloorB.totalEmployees, 1);
  assert.equal(ownFloorB.scope, "company");
  assert.equal(JSON.stringify(ownFloorB).includes("WFM5-001"), false);

  const ownList = await ok(actors.hr, separationPath(organizationId));
  assert.ok(Array.isArray(ownList.separations));
  assert.deepEqual(ownList.separations.map((row: any) => Number(row.id)), [ownSeparation.id],
    "HR must see the real draft A separation, not B records");
  assert.equal(ownList.separations[0].status, "draft");
  assert.equal(ownList.separations[0].releasedAt, null,
    "an acceptance fixture cannot imply a final-pay release");
  assert.equal(JSON.stringify(ownList).includes(victimEmployee.employeeNo), false);
  const ownListB = await ok(actors.tenantB, separationPath(tenantB.id));
  assert.deepEqual(ownListB.separations.map((row: any) => Number(row.id)),
    [victimSeparation.id]);
  const filtered = await ok(owner, separationPath(organizationId) +
    "&employeeId=" + victimEmployee.id);
  assert.deepEqual(filtered.separations, [],
    "foreign employee filter must not reveal another employer's separation");

  // Signed-in tenant switches and out-of-scope roles must fail at the server,
  // not merely be hidden by a React tab or client-side navigation.
  for (const [who, actor, target, expected] of [
    ["A owner to B floor", owner, floorPath(tenantB.id), 403],
    ["B owner to A floor", actors.tenantB, floorPath(organizationId), 403],
    ["employee to A floor", actors.employee0, floorPath(organizationId), 403],
    ["payroll-only role to A floor", actors.payroll, floorPath(organizationId), 403],
    ["A owner to B separation", owner, separationPath(tenantB.id), 403],
    ["B owner to A separation", actors.tenantB, separationPath(organizationId), 403],
    ["employee to A separation", actors.employee0, separationPath(organizationId), 403],
    ["manager to A separation", actors.manager, separationPath(organizationId), 403],
  ] as Array<[string, Client, string, number]>) {
    const refused = await actor.json(target);
    assert.equal(refused.response.status, expected, who);
    assert.equal(JSON.stringify(refused.data).includes(victimEmployee.employeeNo), false,
      who + " must not leak victim worker identifiers");
  }
  const visitor = new Client();
  assert.equal((await visitor.json(floorPath(organizationId))).response.status, 401);
  assert.equal((await visitor.json(separationPath(organizationId))).response.status, 401);
  assert.equal((await owner.json("/api/workforce/live-floor?organizationId=" +
    organizationId + "&page=0")).response.status, 400);
  // Revoke the existing HR membership while leaving its authenticated session
  // intact: both read APIs must immediately deny the stale identity.
  await db.update(userOrganizations).set({ active: false })
    .where(eq(userOrganizations.userId, roleUsers[1].id));
  assert.equal((await actors.hr.json(floorPath(organizationId))).response.status, 403);
  assert.equal((await actors.hr.json(separationPath(organizationId))).response.status, 403);
  assert.deepEqual(await db.select().from(separationRecords), originalSeparationRows,
    "all GET attempts must preserve the exact original separation ledger");
  assert.deepEqual(await db.select().from(employeeWorksiteAssignments), originalWorksiteRows,
    "all GET attempts must leave worksite assignments unchanged");
  evidence("issue-1113-real-http-live-floor-decision-column-company-unit-tenant-role-revocation");
  evidence("issue-1113-real-http-separation-38-column-draft-read-tenant-role-revocation");
  report.issue1113 = {
    kind: "synthetic-localhost-read-only", committedHead: process.env.GITHUB_SHA ?? null,
    liveFloor: "checked", separation: "checked", signedInRoles: true,
    releaseOrPayout: "NOT_PERFORMED", deployedAppUat: "NOT_RUN",
    independentHumanUat: "NOT_RUN", productionSchemaAuthorization: "NOT_GRANTED",
  };

  report.result="PASS_SYNTHETIC_DEV_ONLY";
  report.employeeCount=5;
  report.totalPayrollEvidenceMinutes=observedTotal;
  report.payrollRunStatus=persisted[0].status;
  report.managerAndHrAreDistinct=true;
  report.noPayoutOrPayrollRelease=true;
  report.currentDayClockNotSameAsHistoricalPayrollPeriod=true;
  console.log("WFM-5 PASS: five fictional workers, two reviewer roles, 48 hours source-traced, no release/payment.");
}
function saveReport() {
  mkdirSync("qa-artifacts",{recursive:true});
  writeFileSync("qa-artifacts/wfm-five-worker-dev-report.json",JSON.stringify(report,null,2)+"\n");
}
run().catch(error=>{
  report.result="FAIL_SYNTHETIC_DEV";
  report.failure=String(error instanceof Error?error.message:error).slice(0,400);
  console.error("WFM-5 FAIL:",report.failure);
  process.exitCode=1;
}).finally(async()=>{
  saveReport();
  await pool.end();
});
