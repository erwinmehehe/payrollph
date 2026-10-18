/**
 * 100-fictional-worker connected WFM -> payroll-preflight / payroll-preview QA.
 * This is a development-only regression, NOT independent human UAT or real pay.
 * It may run only in a GitHub Actions job with an empty disposable loopback PG16.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { employees, orgUnits, organizations, payrollRuns, timePunches, userOrganizations, users } from "../../src/db/schema";
import { hashPassword } from "../../src/lib/crypto";
import { buildPayrollAssurance } from "../../src/lib/payroll-assurance-server";
import { evaluatePayrollAssurance } from "../../src/lib/payroll-assurance";
import { buildEmployeeTimesheetSnapshot } from "../../src/lib/workforce-timesheet-server";

const BASE = "http://127.0.0.1:3000";
const START = "2026-06-01";
const END = "2026-06-15";
const WORK = "2026-06-10";
const HOLIDAY = "2026-06-12";
const PAY_DATE = "2026-06-20";
const PASSWORD = "FictionalOnly!1-" + randomUUID().replaceAll("-", "").slice(0, 24);
const missingTimesheetIds = new Set([3, 14, 25, 36, 47, 58]);
const pendingTimesheetIds = new Set([69, 80, 91]);
const noBankIds = new Set([9, 76]);
const overnightIds = new Set([6, 51, 96]);
const holidayIds = new Set([5, 17, 49, 73, 97]);
const cases = Object.fromEntries(
  Array.from({length: 22}, (_, i) => ["PF-" + String(i + 1).padStart(2, "0"), {
    status: "NOT_RUN", proof: "No executed PayrollPH case evidence",
  }]),
);
const report: Record<string, any> = {
  benchmark: "competitive-100-worker-app-acceptance",
  sourceSha: "NOT_RUN",
  workflowEventSha: process.env.GITHUB_SHA ?? "unknown",
  checkoutRef: "pull_request.head.sha",
  result: "NOT_RUN",
  fixtureOnly: true,
  period: {start: START, end: END, payDate: PAY_DATE},
  expectedWorkers: 100,
  employeeDataReal: false,
  environment: "GitHub Actions disposable PostgreSQL 16 and localhost Next.js",
  independentHumanUat: "NOT_RUN",
  realEmployerReconciliation: "NOT_RUN",
  externalVendorComparison: "NOT_RUN",
  officialGovernmentAcceptance: "NOT_RUN",
  payrollRecordsReleased: false,
  moneyMoved: false,
  externalGovernmentSubmission: false,
  realAIModelCalled: false,
  cases,
};
function wid(n: number) { return "F" + String(n).padStart(3, "0"); }
function mark(caseId: string, proof: string, level = "APP_OBSERVED_SYNTHETIC") {
  cases[caseId] = {status: level, proof};
}
function guard() {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_EVENT_NAME, "pull_request");
  assert.ok(process.env.GITHUB_RUN_ID);
  const headSha = process.env.QA_EXPECTED_HEAD_SHA ?? "";
  assert.match(headSha, /^[0-9a-f]{40}$/, "PR head SHA must be provided by GitHub");
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim();
  assert.equal(checkoutSha, headSha, "QA must execute the standalone PR head, not the synthetic merge ref");
  report.sourceSha = checkoutSha;
  assert.equal(process.env.QA_URL, BASE);
  assert.equal(process.env.DEMO_MODE, "false");
  assert.equal(process.env.REQUIRE_PRIVILEGED_MFA, "false");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(target.protocol, "postgresql:");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "5432");
  assert.equal(target.pathname, "/app_db");
  assert.equal(target.username, "postgres");
  assert.equal(target.password, "postgres");
  assert.equal(target.search, "");
  for (const flag of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_PAYOUTS_LIVE_APPROVED", "OPENAI_AUTOMATION_DRAFT_ENABLED",
    "AUTOMATION_LANGUAGE_STUDIO_ENABLED",
  ]) assert.equal(process.env[flag], "false", flag + " must be explicitly false");
  for (const secret of [
    "OPENAI_API_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
  ]) assert.equal(process.env[secret] ?? "", "", secret + " must be absent");
}
class Client {
  cookie = "";
  async json(path: string, method = "GET", data?: unknown, extra?: Record<string,string>) {
    const headers: Record<string,string> = {...(extra ?? {})};
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== "GET") headers.origin = BASE;
    if (data !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(BASE + path, {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
      redirect: "manual", signal: AbortSignal.timeout(90_000),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    return {status: response.status, ok: response.ok, data: await response.json().catch(() => ({})) as any};
  }
  async ok(path: string, method = "GET", data?: unknown, extra?: Record<string,string>) {
    const r = await this.json(path, method, data, extra);
    assert.ok(r.ok, method + " " + path + " -> " + r.status + " " + JSON.stringify(r.data).slice(0,450));
    return r.data;
  }
}
async function login(email: string) {
  const client = new Client();
  await client.ok("/api/auth/login", "POST", {email, password: PASSWORD});
  assert.ok(client.cookie);
  return client;
}
async function batches<T,U>(values: readonly T[], size: number, operation: (item:T)=>Promise<U>): Promise<U[]> {
  const result: U[] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(...await Promise.all(values.slice(offset, offset + size).map(operation)));
  }
  return result;
}
function ph(date: string, hour: string) { return new Date(date + "T" + hour + ":00+08:00"); }
async function execute() {
  guard();
  const version = await pool.query("SELECT current_setting('server_version_num')::integer AS value");
  assert.equal(Math.floor(Number(version.rows[0].value) / 10000),16);
  assert.equal((await db.select({id:organizations.id}).from(organizations)).length,0,
    "Never seed a database containing existing organizations");

  const bootstrap = new Client();
  const setup = await bootstrap.ok("/api/setup", "POST", {
    companyName: "Synthetic Benchmark Employer A",
    legalName: "Synthetic Benchmark Employer A Ltd.",
    name: "Fictional Owner", email: "owner.comp100@linaw.test", password: PASSWORD,
  }, {"x-setup-token":process.env.SETUP_TOKEN ?? ""});
  const orgId = Number(setup.organizationId);
  assert.ok(orgId > 0);
  const owner = await login("owner.comp100@linaw.test");

  const nums = Array.from({length:100},(_,i)=>i+1);
  const staff = await batches(nums, 4, async n => {
    const region = n <= 40 ? "NCR" : n <= 75 ? "VII" : "XI";
    const payBasis = n % 5 < 2 ? "hourly" : "monthly";
    const create = await owner.ok("/api/employees", "POST", {
      organizationId: orgId, employeeNo: wid(n), firstName:"Fictional",
      lastName:"Worker" + String(n).padStart(3,"0"),
      email:"f" + String(n).padStart(3,"0") + ".comp100@linaw.test",
      title:"QA-Only Worker", payBasis,
      rateAmount: payBasis === "hourly" ? 250 : 32000 + n * 20,
      standardWorkDaysPerMonth:22, standardHoursPerDay:8,
      region, startDate:n === 24 ? "2026-06-08" : "2026-01-01",
      mobile:"QAONLY" + String(n).padStart(4,"0"),
      bankAccount:noBankIds.has(n) ? "" : "NONREAL" + String(n).padStart(7,"0"),
      bankCode:noBankIds.has(n) ? "" : "BDO",
      tinBranchCode:"0000", restDay:"Sunday",
    });
    const id = Number(create.employee?.id);
    assert.ok(id > 0, "Employee create must return persisted ID");
    return {id, number:n, code:wid(n), payBasis, region};
  });
  assert.equal(staff.length,100);
  assert.equal(new Set(staff.map(w=>w.id)).size,100);
  assert.deepEqual([
    staff.filter(w=>w.region==="NCR").length,
    staff.filter(w=>w.region==="VII").length,
    staff.filter(w=>w.region==="XI").length,
  ],[40,35,25]);
  report.createdWorkers=100;
  report.regionalCohorts={NCR:40,VII:35,XI:25};
  report.creationChannel="authenticated owner employee-create API (fictional, no real identity data)";

  const [unit] = await db.insert(orgUnits).values({
    organizationId:orgId, type:"department", code:"COMP100-QA",name:"Synthetic Multi-Region Operations",
  }).returning();
  await db.update(employees).set({orgUnitId:unit.id}).where(eq(employees.organizationId,orgId));
  const [tenantB] = await db.insert(organizations).values({
    name:"Synthetic Benchmark Tenant B",legalName:"Synthetic Benchmark Tenant B Ltd.",plan:"Core",
  }).returning();
  const spec = [
    {key:"manager",role:"manager"},{key:"hr",role:"hr"},
    // Multiple authorized fictional HR reviewers, not a rate-limit bypass.
    {key:"scheduler2",role:"hr"},{key:"scheduler3",role:"hr"},
    {key:"payroll",role:"payroll"},{key:"checker",role:"checker"},
    {key:"tenantb",role:"owner"},
  ];
  const userRows = await db.insert(users).values(spec.map(x=>({
    name:"Fictional " + x.key,email:x.key + ".comp100@linaw.test",
    passwordHash:hashPassword(PASSWORD),role:x.role,totpEnabled:false,backupCodes:[],
  }))).returning();
  await db.insert(userOrganizations).values(userRows.map((u,i)=>({
    userId:u.id,organizationId:spec[i].key==="tenantb"?tenantB.id:orgId,
    role:spec[i].role,orgUnitId:i===0?unit.id:null,
  })));
  const actors = Object.fromEntries(await Promise.all(spec.map(async x=>[
    x.key,await login(x.key+".comp100@linaw.test"),
  ]))) as Record<string,Client>;
  const deniedA=await actors.tenantb.json("/api/employees?organizationId="+orgId);
  assert.equal(deniedA.status,403,"Tenant B cannot inspect A's employee directory");
  const deniedB=await owner.json("/api/employees?organizationId="+tenantB.id);
  assert.equal(deniedB.status,403);
  mark("PF-21","Authenticated two-way tenant directory denial (403)");

  const shift=async(code:string,from:string,to:string)=>{
    const x=await owner.ok("/api/workforce/schedules","POST",{
      organizationId:orgId,action:"create_shift",code,name:code,
      startTime:from,endTime:to,breakMinutes:60,
    });
    const id=Number(x.shift?.id);assert.ok(id>0);return id;
  };
  const day=await shift("COMP100-DAY","09:00","18:00");
  const night=await shift("COMP100-NIGHT","22:00","06:00");
  const pattern=async(code:string,shiftId:number)=>{
    const x=await owner.ok("/api/workforce/schedules","POST",{
      organizationId:orgId,action:"create_pattern",code,name:code,cycleDays:15,
      days:Array.from({length:15},(_,i)=>i===9
        ? {isRestDay:false,label:"Only historical scheduled workday",segments:[{shiftDefinitionId:shiftId}]}
        : {isRestDay:true,label:"No required shift during synthetic payroll period"}),
    });
    const id=Number(x.pattern?.id);assert.ok(id>0);return id;
  };
  const dayPattern=await pattern("COMP100-DAY-PATTERN",day);
  const nightPattern=await pattern("COMP100-NIGHT-PATTERN",night);
  const scheduleActors=[owner,actors.hr,actors.scheduler2,actors.scheduler3];
  const assignments=await batches(staff,5,async worker=>{
    const authorizedScheduler=scheduleActors[Math.floor((worker.number-1)/25)];
    const schedule=await authorizedScheduler.ok("/api/workforce/schedules","POST",{
      organizationId:orgId,action:"assign_schedule",employeeId:worker.id,
      patternId:overnightIds.has(worker.number)?nightPattern:dayPattern,
      effectiveFrom:START,effectiveUntil:END,anchorDate:START,
      reason:"Historical fictional comparison, not real scheduling",
    });
    assert.ok(Number(schedule.assignment?.id)>0);
    return Number(schedule.assignment.id);
  });
  assert.equal(assignments.length,100);
  const rosterPages=await batches([1,2,3,4,5],2,async page=>
    owner.ok("/api/workforce/team-roster?organizationId="+orgId+"&startDate=2026-06-08&page="+page));
  assert.ok(rosterPages.every(r=>Number(r.totalEmployees)===100));
  const rosterIds=rosterPages.flatMap(r=>(r.rows??[]).map((row:any)=>Number(row.employee?.id)));
  assert.equal(rosterIds.length,100,"Five roster pages must contain all 100 workers");
  assert.deepEqual(new Set(rosterIds),new Set(staff.map(w=>w.id)),
    "Roster pagination must neither duplicate nor omit employees");
  report.rosterPageCount=rosterPages.length;
  report.scheduleAssignments=100;

  const punches=staff.map(w=>{
    const isNight=overnightIds.has(w.number);
    const timeIn=ph(WORK,isNight?"22:00":"09:00");
    const timeOut=ph(isNight?"2026-06-11":WORK,isNight?"06:00":w.number===8?"19:00":"18:00");
    const brkStart=ph(isNight?"2026-06-11":WORK,isNight?"02:00":"12:00");
    const brkEnd=ph(isNight?"2026-06-11":WORK,isNight?"03:00":"13:00");
    return {
      organizationId:orgId,employeeId:w.id,workDate:WORK,timeIn,timeOut,
      breakStart:brkStart,breakEnd:brkEnd,
      shiftStart:isNight?"22:00":"09:00",shiftEnd:isNight?"06:00":"18:00",
      status:"Complete",source:"comp100-synth-history",
    };
  });
  for(const worker of staff.filter(w=>holidayIds.has(w.number))){
    punches.push({
      organizationId:orgId,employeeId:worker.id,workDate:HOLIDAY,
      timeIn:ph(HOLIDAY,"09:00"),timeOut:ph(HOLIDAY,"18:00"),
      breakStart:ph(HOLIDAY,"12:00"),breakEnd:ph(HOLIDAY,"13:00"),
      shiftStart:"09:00",shiftEnd:"18:00",status:"Complete",
      source:"comp100-synth-history",
    });
  }
  assert.ok(punches.every(p=>p.source.length<=32),"Synthetic source must fit the database varchar(32) constraint");
  const persistedPunches=await db.insert(timePunches).values(punches).returning({id:timePunches.id});
  assert.equal(persistedPunches.length,105);
  report.historicalSyntheticPunches=105;
  mark("PF-08","Three historical overnight punches seeded and linked to approved schedule; payroll trace checked below");
  mark("PF-09","Five June 12 holiday-work punches seeded; payroll trace checked below");

  const otWorker=staff[7];
  const requested=await owner.ok("/api/workforce/overtime","POST",{
    organizationId:orgId,action:"create_request",employeeId:otWorker.id,
    workDate:WORK,requestedMinutes:60,requestKind:"pre_approved",
    reason:"Synthetic one hour OT; distinct reviewer",
  });
  const otId=Number(requested.request?.id);assert.ok(otId>0);
  const otDecision=await actors.manager.ok("/api/workforce/overtime","POST",{
    organizationId:orgId,action:"decide_request",requestId:otId,
    decision:"approved",decisionNote:"Synthetic manager approval only",
  });
  assert.equal(otDecision.request?.status??otDecision.requests?.[0]?.status,"approved");

  await owner.ok("/api/workforce/timesheets","POST",{
    organizationId:orgId,action:"update_policy",active:true,enforcementMode:"block",
  });
  const pre=await actors.payroll.json("/api/payroll-runs","POST",{
    organizationId:orgId,periodStart:START,periodEnd:END,payDate:PAY_DATE,processNow:true,
  });
  assert.equal(pre.status,422,"Missing timecards must gate the real PayrollPH payroll route");
  assert.equal(pre.data.code,"TIMESHEET_APPROVAL_REQUIRED");
  mark("PF-01","Authenticated payroll POST blocked by actual required-timesheet policy");

  // Create 94 submitted timecards; leave six absent and three unapproved.
  const present=staff.filter(w=>!missingTimesheetIds.has(w.number));
  const submitted=await batches(present,4,async w=>{
    const snapshot=await buildEmployeeTimesheetSnapshot({
      organizationId:orgId,employeeId:w.id,periodStart:START,periodEnd:END,
    });
    assert.equal(snapshot.blockerCount,0,w.code+" has unexpected WFM snapshot blockers");
    const submitter=w.number<=50?actors.manager:owner;
    const response=await submitter.ok("/api/workforce/timesheets","POST",{
      organizationId:orgId,action:"submit",employeeId:w.id,
      periodStart:START,periodEnd:END,
    });
    const id=Number(response.timesheet?.id);assert.ok(id>0);
    return {id,worker:w};
  });
  assert.equal(submitted.length,94);
  const representative=submitted.find(x=>x.worker.number===69);
  assert.ok(representative);
  // F069 was submitted by owner, so use the original maker for a true self-approval denial.
  const sameApprover=await owner.json("/api/workforce/timesheets","POST",{
    organizationId:orgId,action:"decide",timesheetId:representative.id,decision:"approved",
  });
  assert.equal(sameApprover.status,409,"No maker self-approval");
  const approved=await batches(submitted.filter(x=>!pendingTimesheetIds.has(x.worker.number)),4,async x=>{
    const reviewer=x.worker.number<=50?actors.hr:actors.scheduler2;
    const res=await reviewer.ok("/api/workforce/timesheets","POST",{
      organizationId:orgId,action:"decide",timesheetId:x.id,decision:"approved",
      decisionNote:"Fictional independent HR role, no human UAT",
    });
    assert.equal(res.timesheet?.status,"approved");
    assert.notEqual(res.timesheet.submittedByUserId,res.timesheet.decidedByUserId);
    return x.id;
  });
  assert.equal(approved.length,91);
  const blocked=await actors.payroll.json("/api/payroll-runs","POST",{
    organizationId:orgId,periodStart:START,periodEnd:END,payDate:PAY_DATE,processNow:true,
  });
  assert.equal(blocked.status,422);
  assert.equal(blocked.data.code,"TIMESHEET_APPROVAL_REQUIRED");
  mark("PF-02","Three unapproved timesheets and six absent; maker self-approval rejected and payroll denied");

  // Resolve ALL nine outstanding timesheet states using explicit independent synthetic actors.
  const leftovers=submitted.filter(x=>pendingTimesheetIds.has(x.worker.number));
  await batches(leftovers,3,async x=>{
    const reviewer=x.worker.number<=50?actors.hr:actors.scheduler2;
    const res=await reviewer.ok("/api/workforce/timesheets","POST",{
      organizationId:orgId,action:"decide",timesheetId:x.id,decision:"approved",
      decisionNote:"Synthetic post-block approval",
    });assert.equal(res.timesheet?.status,"approved");return true;
  });
  const absent=staff.filter(w=>missingTimesheetIds.has(w.number));
  const nowSubmitted=await batches(absent,3,async w=>{
    const submitter=w.number<=50?actors.manager:owner;
    const x=await submitter.ok("/api/workforce/timesheets","POST",{
      organizationId:orgId,action:"submit",employeeId:w.id,periodStart:START,periodEnd:END,
    });
    return {id:Number(x.timesheet?.id),worker:w};
  });
  await batches(nowSubmitted,3,async item=>{
    const reviewer=item.worker.number<=50?actors.hr:actors.scheduler2;
    const x=await reviewer.ok("/api/workforce/timesheets","POST",{
      organizationId:orgId,action:"decide",timesheetId:item.id,decision:"approved",
      decisionNote:"Synthetic missing timecard resolved by distinct reviewer",
    });assert.equal(x.timesheet?.status,"approved");return true;
  });
  report.timesheetStates={initiallyMissing:6,initiallyUnapproved:3,finallyApproved:100};

  await actors.hr.ok("/api/workforce/attendance-locks","POST",{
    organizationId:orgId,action:"set_policy",requirePayrollCutoffLock:true,
  });
  const withoutLock=await actors.payroll.json("/api/payroll-runs","POST",{
    organizationId:orgId,periodStart:START,periodEnd:END,payDate:PAY_DATE,processNow:true,
  });
  assert.equal(withoutLock.status,422);
  assert.equal(withoutLock.data.code,"ATTENDANCE_CUTOFF_LOCK_REQUIRED");
  const locked=await actors.hr.ok("/api/workforce/attendance-locks","POST",{
    organizationId:orgId,action:"lock_period",periodStart:START,periodEnd:END,
    lockType:"payroll_cutoff",reason:"Fictional independent QA no-money cutoff",
  });
  assert.equal(locked.lock?.status,"locked");

  const calculated=await actors.payroll.ok("/api/payroll-runs","POST",{
    organizationId:orgId,periodStart:START,periodEnd:END,payDate:PAY_DATE,processNow:true,
  });
  const runId=Number(calculated.run?.id);
  assert.ok(runId>0,"Only application-calculated payroll runs count");
  assert.notEqual(calculated.run.status,"Released");
  const register=await actors.payroll.ok("/api/payroll-runs?runId="+runId+"&include=entries");
  assert.equal(register.entries?.length,100,"Exactly 100 source-connected employee payroll entries required");
  assert.deepEqual(new Set(register.entries.map((x:any)=>Number(x.employeeId))),
    new Set(staff.map(w=>w.id)));
  let sourceTraced=0,nightTraced=0,holidayTraced=0,otTraced=false;
  for(const worker of staff) {
    const row=register.entries.find((x:any)=>Number(x.employeeId)===worker.id);
    assert.ok(row?.trace,"Missing persisted payroll trace for "+worker.code);
    const segments=row.trace.payableTime?.segments??[];
    if(segments.some((s:any)=>s.sourceWorkDate===WORK && Number(s.minutes)>0))sourceTraced++;
    if(overnightIds.has(worker.number) && segments.some((s:any)=>s.night && Number(s.minutes)>0))nightTraced++;
    if(holidayIds.has(worker.number) && segments.some((s:any)=>s.calendarDate===HOLIDAY && Number(s.minutes)>0))holidayTraced++;
    if(worker.number===8 && segments.some((s:any)=>s.overtime && Number(s.minutes)>0))otTraced=true;
  }
  assert.equal(sourceTraced,100,"Every worker must retain work-date source lineage");
  assert.equal(nightTraced,3,"Three representative nights must trace");
  assert.equal(holidayTraced,5,"Five June 12 holiday source traces required");
  assert.ok(otTraced,"Approved worked overtime must have segment evidence");
  report.payrollPreview={runCreated:true,entryCount:100,sourceTraced,nightTraced,holidayTraced,approvedOtTraced:otTraced};
  mark("PF-06","F008 overtime approved by separate manager, calculated with overtime segment");
  mark("PF-08","Three night-shift payroll segments retain original source traces");
  mark("PF-09","Five June 12 holiday-work payroll segments retain source dates; statutory amounts NOT independently certified");

  const assuranceResult=await buildPayrollAssurance(runId);
  assert.ok(assuranceResult);
  const assurance=assuranceResult.assurance;
  const missingBanks=new Set((assurance.findings??[])
    .filter((x:any)=>x.code==="MISSING_BANK_DETAILS"&&x.blocking)
    .map((x:any)=>Number(x.employeeId)));
  for(const worker of staff.filter(w=>noBankIds.has(w.number))) {
    assert.ok(missingBanks.has(worker.id),worker.code+" missing bank must be a blocking finding");
  }
  mark("PF-03","Two real calculated payroll entries yield blocking MISSING_BANK_DETAILS findings");
  report.assurance={blocking:assurance.summary.blocking,high:assurance.summary.high,
    medium:assurance.summary.medium,missingBanks:missingBanks.size};

  // Input-only comparison: these deliberately fictional prior/current net amounts
  // were NOT produced by the application run above and cannot certify root cause.
  const fakePrevious=staff.map(w=>({
    id:w.id*2,employeeId:w.id,grossPay:25000,deductions:3000,
    netPay:(1800000+(w.number%13)*37000)/100,status:"Ready",
  }));
  const fakeCurrent=staff.map(w=>{
    const previous=(1800000+(w.number%13)*37000)/100;
    const delta:Record<number,number>={12:7800,21:4200,44:-6500,89:8500};
    const net=previous+(delta[w.number]??0);
    return {id:w.id*2+1,employeeId:w.id,grossPay:net+3000,
      deductions:3000,netPay:net,status:"Ready"};
  });
  const compared=evaluatePayrollAssurance(fakeCurrent,fakePrevious);
  assert.equal(compared.comparisons.length,100);
  for(const n of [12,44,89])assert.ok(compared.comparisons.some(x=>
    x.employeeId===staff[n-1].id&&x.hasMaterialChange));
  mark("PF-15","Real PayrollPH assurance function detects three injected fixture variances; these comparison amounts are NOT from actual payroll run","PURE_FUNCTION_SYNTHETIC");
  report.comparisonFixture={employeesCompared:100,variancesDetected:true,
    source:"fixture-injected prior/current values, not a real second released payroll"};

  const deniedRun=await actors.tenantb.json("/api/payroll-runs?runId="+runId+"&include=entries");
  assert.ok([403,404].includes(deniedRun.status),"Tenant B cannot access A payroll register");
  mark("PF-21","403 tenant A employee denial plus direct tenant B payroll register denial");
  const checklist=await owner.ok("/api/payroll-runs/"+runId+"/release-checklist");
  assert.equal(checklist.ready,false,"Run with missing payout profiles cannot be releasable");
  const premature=await owner.json("/api/compliance/filing-validations","POST",{
    organizationId:orgId,runId,agency:"BIR",form:"1601-C",
  });
  assert.equal(premature.status,422,"A midmonth payroll cutoff cannot produce the monthly 1601-C worksheet");
  assert.match(String(premature.data.error??""),/final payroll cutoff/i);
  mark("PF-20","Midmonth BIR 1601-C worksheet rejected until final cutoff; agency filing and acceptance NOT_RUN","NEGATIVE_GATE_ONLY");
  const [stored]=await db.select().from(payrollRuns)
    .where(and(eq(payrollRuns.id,runId),eq(payrollRuns.organizationId,orgId))).limit(1);
  assert.ok(stored&&stored.status!=="Released");
  report.payrollRunStatus=stored.status;
  report.payrollRecordsReleased=false;
  report.moneyMoved=false;
  report.externalGovernmentSubmission=false;
  mark("PF-22","Explicit disabled provider flags, no release and no agency submission in isolated CI");
  report.result="PASS_SYNTHETIC_PREVIEW_ONLY";
  console.log("BENCH100 synthetic cohort PASS: 100 calculated entries, payroll NOT released; no money or filing.");
}
async function persist() {
  mkdirSync("qa-artifacts",{recursive:true});
  report.caseCounts={
    observed:Object.values(cases).filter((x:any)=>x.status==="APP_OBSERVED_SYNTHETIC").length,
    negativeOnly:Object.values(cases).filter((x:any)=>x.status==="NEGATIVE_GATE_ONLY").length,
    pureFunctionOnly:Object.values(cases).filter((x:any)=>x.status==="PURE_FUNCTION_SYNTHETIC").length,
    notRun:Object.values(cases).filter((x:any)=>x.status==="NOT_RUN").length,
  };
  report.reportSha256=createHash("sha256").update(JSON.stringify(report)).digest("hex");
  writeFileSync("qa-artifacts/competitive-100-worker-app-report.json",
    JSON.stringify(report,null,2)+"\n");
}
execute().catch(error=>{
  report.result="FAIL_SYNTHETIC_BENCHMARK";
  report.error=String(error instanceof Error?error.message:error).slice(0,420);
  console.error("BENCH100 failure: "+report.error);
  process.exitCode=1;
}).finally(async()=>{await persist();await pool.end();});
