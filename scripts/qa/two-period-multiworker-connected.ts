/**
 * Fictional 10-worker/two-cutoff HTTP payroll rehearsal.
 * Historical time punches are seeded QA fixtures (NOT live Web Bundy events).
 * No real employer, bank transfer, agency submission or human UAT.
 * Must run after the existing nine-stage A/B journey on disposable PG16.
 */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {and,eq} from "drizzle-orm";
import {db,pool} from "../../src/db";
import {parseCsv} from "../../src/lib/csv-import";
import {hashPassword} from "../../src/lib/crypto";
import {employees,governmentFilingValidations,orgUnits,organizations,payrollEntries,
  payrollRuns,payslips,payoutBatches,payoutTransfers,timePunches,userOrganizations,
  users,workforceTimesheets} from "../../src/db/schema";

const BASE="http://127.0.0.1:3000", COUNT=10;
const output="qa-artifacts/ten-worker-two-period-report.json";
const report:{schemaVersion:number;sourceSha:string;status:string;scope:string;
  workerCount:number;periods:Array<Record<string,unknown>>;
  historicalPunchesAreSeededFixtures:boolean;independentHumanUat:string;
  realEmployerComparison:string;liveBankOrAgencySubmissions:string;errorCategory?:string}={
  schemaVersion:1,sourceSha:process.env.PR_HEAD_SHA??"UNVERIFIED",status:"BLOCKED",
  scope:"fictional-disposable-localhost-pg16",workerCount:COUNT,periods:[],
  historicalPunchesAreSeededFixtures:true,independentHumanUat:"NOT_RUN",
  realEmployerComparison:"NOT_RUN",liveBankOrAgencySubmissions:"PROHIBITED",
};
function cents(v:unknown):bigint{
  const s=String(v);assert.match(s,/^-?\d+(?:\.\d{1,2})?$/,"Not exact centavo money");
  const [whole,fraction=""]=s.replace(/^-/,"").split(".");
  const n=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));
  return s.startsWith("-")?-n:n;
}
function iso(d:Date){return d.toISOString().slice(0,10);}
function dUtc(s:string){return new Date(s+"T00:00:00Z");}
function addDay(s:string){const d=dUtc(s);d.setUTCDate(d.getUTCDate()+1);return iso(d);}
function cutoffs(clock:string){
  assert.match(clock,/^\d{4}-\d{2}-\d{2}$/);
  const prior=dUtc(clock.slice(0,7)+"-01");prior.setUTCDate(0);
  const end=iso(prior), month=end.slice(0,7), start=month+"-01";
  const anchor=dUtc(start);anchor.setUTCDate(anchor.getUTCDate()-(anchor.getUTCDay()+6)%7);
  const workdays:string[]=[];
  for(let date=start;date<=end;date=addDay(date)){
    const day=dUtc(date).getUTCDay();if(day!==0&&day!==6)workdays.push(date);
  }
  assert.ok(workdays.length>=18&&workdays.length<=23);
  return {start,end,anchor:iso(anchor),workdays,periods:[
    {start,end:month+"-15"},{start:month+"-16",end},
  ]};
}
function guard(){
  const env:{[name:string]:string}={
    CI:"true",GITHUB_ACTIONS:"true",QA_URL:BASE,NINE_STAGE_PG_MAJOR:"16",
    NINE_STAGE_HIRE_MODE:"direct",DEMO_MODE:"false",
    PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",
    XENDIT_PAYOUTS_LIVE_APPROVED:"false",
  };
  for(const [key,value] of Object.entries(env))assert.equal(process.env[key],value,key+" must be set safely");
  for(const key of ["OPENAI_API_KEY","PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY"]){
    assert.equal(process.env[key]??"","","Provider credentials prohibited: "+key);
  }
  const url=new URL(process.env.DATABASE_URL??"");
  assert.equal(url.protocol,"postgresql:");assert.equal(url.hostname,"127.0.0.1");
  assert.equal(url.port,"5432");assert.equal(url.pathname,"/app_db");assert.equal(url.username,"postgres");
  assert.match(process.env.PR_HEAD_SHA??"",/^[a-f0-9]{40}$/);
  const prior=JSON.parse(readFileSync("qa-artifacts/nine-stage-connected-report.json","utf8"));
  assert.equal(prior.result,"PASS");assert.equal(prior.sourceSha,process.env.PR_HEAD_SHA);
  assert.equal(prior.stages.length,9);assert.equal(prior.employerBStages.length,9);
  assert.ok([...prior.stages,...prior.employerBStages].every((s:{status:string})=>s.status==="PASS"));
  assert.equal(prior.bankOrPaymentSubmission,"PROHIBITED");
}
class Client{
  cookie="";
  async request(path:string,method="GET",data?:unknown){
    const headers=new Headers();
    if(this.cookie)headers.set("cookie",this.cookie);
    if(method!=="GET"){headers.set("origin",BASE);headers.set("content-type","application/json");}
    const result=await fetch(BASE+path,{method,headers,
      body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
    const cookie=result.headers.get("set-cookie");if(cookie)this.cookie=cookie.split(";")[0];
    return result;
  }
  async json(path:string,method="GET",data?:unknown){
    const response=await this.request(path,method,data);
    const body=await response.json().catch(()=>({})) as Record<string,any>;
    return {ok:response.ok,status:response.status,body};
  }
  async ok(path:string,method="GET",data?:unknown){
    const result=await this.json(path,method,data);
    assert.ok(result.ok,"HTTP "+method+" "+path.split("?")[0]+" "+result.status+
      " code="+String(result.body.code??"unclassified").slice(0,40));
    return result.body;
  }
}
async function login(email:string,password:string){
  const c=new Client();
  let r=await c.json("/api/auth/login","POST",{email,password});
  if(r.status===429){
    const ms=Number(r.body.retryAfterMs);
    assert.ok(Number.isInteger(ms)&&ms>=0&&ms<=60000,"Rate limiter retry outside safe window");
    await new Promise<void>(resolve=>setTimeout(resolve,ms+250));
    r=await c.json("/api/auth/login","POST",{email,password});
  }
  assert.equal(r.status,200,"Expected real protected fictional login");
  assert.ok(c.cookie,"Missing authenticated session");return c;
}
async function main(){
  guard();
  // Independently created credentials stay in memory. Never forward password
  // material read from an artifact file into an HTTP request (CodeQL boundary).
  const password="FictionalOnly!"+randomUUID().replaceAll("-","").slice(0,20);
  const pg=await pool.query("select current_setting('server_version_num')::integer as ver");
  assert.equal(Math.floor(Number(pg.rows[0]?.ver)/10000),16);
  const existing=await db.select({id:organizations.id}).from(organizations);
  assert.equal(existing.length,2,"Refuse unexpected/shared DB; need two original QA tenants only");
  const {start,end,anchor,workdays,periods}=cutoffs(process.env.NINE_STAGE_SYNTHETIC_CLOCK??"");
  const [org]=await db.insert(organizations).values({
    name:"Fictional Two-Cutoff Employer C",legalName:"Fictional Two-Cutoff Employer C Inc.",
  }).returning();
  const [unit]=await db.insert(orgUnits).values({
    organizationId:org.id,type:"department",code:"TWO-CYCLE",name:"QA Payroll Team",
  }).returning();
  const roleNames=["owner","hr","manager","payroll","checker"] as const;
  // Separate fictional Tenant C identities: no sharing Employer A/B credentials,
  // and no need to read the earlier test's plaintext auth handoff from disk.
  const accounts=await db.insert(users).values(roleNames.map(role=>({
    email:role+".twoperiod@linaw.test",name:"Fictional Two-Cutoff "+role,
    role,passwordHash:hashPassword(password),totpEnabled:false,backupCodes:[],
  }))).returning({id:users.id});
  assert.equal(accounts.length,roleNames.length);
  await db.insert(userOrganizations).values(roleNames.map((role,i)=>({
    userId:accounts[i].id,organizationId:org.id,role,
    orgUnitId:role==="manager"?unit.id:null,
  })));
  const sessions=Object.fromEntries(await Promise.all(roleNames.map(async role=>[
    role,await login(role+".twoperiod@linaw.test",password),
  ]))) as Record<typeof roleNames[number],Client>;
  for(const {id} of existing){
    assert.equal((await sessions.owner.json("/api/employees?organizationId="+id)).status,403,
      "Tenant C owner must not read either prior fictional employer");
  }
  assert.equal((await db.select({id:employees.id}).from(employees)
    .where(eq(employees.organizationId,org.id))).length,0);
  const people:number[]=[];
  for(let i=0;i<COUNT;i++){
    const payBasis=i<6?"monthly":i<8?"daily":"hourly";
    const rateAmount=i<6?65000+i*3500:i<8?3000+(i-6)*500:450+(i-8)*50;
    const employee=await sessions.owner.ok("/api/employees","POST",{
      organizationId:org.id,employeeNo:"CYCLE-"+String(i+1).padStart(3,"0"),
      firstName:"Fictional",lastName:"Cohort"+String(i+1).padStart(2,"0"),
      email:"cohort"+(i+1)+".qa@linaw.test",title:"Fictional Payroll Worker",
      payBasis,rateAmount,standardWorkDaysPerMonth:22,standardHoursPerDay:8,
      region:"NCR",startDate:start,bankCode:"BDO",bankAccount:"QA-NONPAYMENT-"+(i+1),
      tin:"QA-TIN-"+(3000+i),sssNo:"QA-SSS-"+(3000+i),
      philHealthNo:"QA-PHIC-"+(3000+i),pagIbigNo:"QA-HDMF-"+(3000+i),tinBranchCode:"0000",
    });
    const id=Number(employee.employee?.id);
    assert.ok(Number.isSafeInteger(id)&&id>0&&!people.includes(id));
    people.push(id);
    await db.update(employees).set({orgUnitId:unit.id})
      .where(and(eq(employees.id,id),eq(employees.organizationId,org.id)));
  }
  const provisioning=await sessions.hr.ok("/api/provisioning?organizationId="+org.id);
  for(const id of people){
    const record=provisioning.employees?.find((e:any)=>Number(e.employeeId)===id);
    assert.ok(record?.onboarding?.length>=5,"Source-owned onboarding must exist");
    for(const task of record.onboarding){
      await sessions.hr.ok("/api/provisioning","PATCH",{
        organizationId:org.id,employeeId:id,id:task.id,done:true,
      });
    }
  }
  const completed=await sessions.hr.ok("/api/provisioning?organizationId="+org.id);
  for(const id of people)assert.ok(completed.employees.find((e:any)=>Number(e.employeeId)===id)
    ?.onboarding.every((t:any)=>t.done),"Every worker must be onboarded");
  const shift=await sessions.hr.ok("/api/workforce/schedules","POST",{
    organizationId:org.id,action:"create_shift",code:"CYCLE-DAY",
    name:"8-hour weekday fixture",startTime:"09:00",endTime:"18:00",breakMinutes:60,
  });
  const shiftId=Number(shift.shift?.id);assert.ok(shiftId>0);
  const pattern=await sessions.hr.ok("/api/workforce/schedules","POST",{
    organizationId:org.id,action:"create_pattern",code:"CYCLE-5-2",
    name:"Five working days, two rest days",cycleDays:7,
    days:Array.from({length:7},(_,i)=>i<5
      ?{isRestDay:false,label:"Work",segments:[{shiftDefinitionId:shiftId}]}
      :{isRestDay:true,label:"Rest",segments:[]}),
  });
  const patternId=Number(pattern.pattern?.id);assert.ok(patternId>0);
  for(const employeeId of people){
    const assigned=await sessions.hr.ok("/api/workforce/schedules","POST",{
      organizationId:org.id,action:"assign_schedule",employeeId,patternId,
      effectiveFrom:start,effectiveUntil:end,anchorDate:anchor,
      reason:"Disposable fictional attendance/payroll verification",
    });
    assert.ok(Number(assigned.assignment?.id)>0);
  }
  // The only direct DB attendance writes are explicitly synthetic historical source fixtures.
  const fixture=people.flatMap(employeeId=>workdays.map(workDate=>({
    organizationId:org.id,employeeId,workDate,
    timeIn:new Date(workDate+"T09:00:00+08:00"),
    timeOut:new Date(workDate+"T18:00:00+08:00"),
    breakStart:new Date(workDate+"T12:00:00+08:00"),
    breakEnd:new Date(workDate+"T13:00:00+08:00"),
    status:"Complete",source:"qa_synthetic_history",shiftStart:"09:00",shiftEnd:"18:00",
  })));
  await db.insert(timePunches).values(fixture);
  const sources=await db.select().from(timePunches).where(eq(timePunches.organizationId,org.id));
  assert.equal(sources.length,fixture.length);
  await sessions.owner.ok("/api/workforce/timesheets","POST",{
    organizationId:org.id,action:"update_policy",active:true,enforcementMode:"block",
  });
  const [checker]=await db.select({id:users.id}).from(users)
    .where(eq(users.email,"checker.twoperiod@linaw.test"));assert.ok(checker?.id);
  const hashesSeen=new Set<string>();
  for(const period of periods){
    const ids:number[]=[];
    for(const employeeId of people){
      const card=await sessions.hr.ok("/api/workforce/timesheets","POST",{
        organizationId:org.id,action:"submit",employeeId,
        periodStart:period.start,periodEnd:period.end,
      });
      assert.equal(Number(card.timesheet?.blockerCount),0,"Unresolved WFM source blocker");
      const id=Number(card.timesheet?.id);assert.ok(id>0);ids.push(id);
      const decision=await sessions.manager.ok("/api/workforce/timesheets","POST",{
        organizationId:org.id,action:"decide",timesheetId:id,
        decision:"approved",decisionNote:"Separated fictional manager approval",
      });
      assert.equal(decision.timesheet?.status,"approved");
      assert.notEqual(decision.timesheet?.submittedByUserId,decision.timesheet?.decidedByUserId);
    }
    assert.equal(new Set(ids).size,COUNT);
    const cards=await db.select().from(workforceTimesheets).where(and(
      eq(workforceTimesheets.organizationId,org.id),
      eq(workforceTimesheets.periodStart,period.start),
      eq(workforceTimesheets.periodEnd,period.end)));
    assert.equal(cards.length,COUNT);assert.ok(cards.every(x=>x.status==="approved"&&x.blockerCount===0));
    const lock=await sessions.hr.ok("/api/workforce/attendance-locks","POST",{
      organizationId:org.id,action:"lock_period",periodStart:period.start,
      periodEnd:period.end,lockType:"payroll_cutoff",reason:"Ten approved fictional timesheets",
    });
    assert.ok(Number(lock.lock?.id)>0);
    const calc=await sessions.payroll.ok("/api/payroll-runs","POST",{
      organizationId:org.id,periodStart:period.start,periodEnd:period.end,
      payDate:period.end,processNow:true,
    });
    const runId=Number(calc.run?.id);assert.ok(runId>0);
    assert.equal(Number(calc.run?.employeeCount),COUNT);
    assert.equal(Number(calc.run?.exceptions),0,"Exceptions block simulated release");
    const register=await sessions.payroll.ok("/api/payroll-runs?runId="+runId+"&include=entries");
    assert.equal(register.entries?.length,COUNT);
    const entries=await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId,runId));
    assert.equal(entries.length,COUNT);assert.deepEqual(new Set(entries.map(x=>x.employeeId)),new Set(people));
    assert.ok(entries.every(x=>x.status==="Ready"));
    const centsTotal=(field:"grossPay"|"netPay")=>entries.reduce((n,x)=>n+cents(x[field]),BigInt(0));
    for(const entry of entries){
      assert.equal(cents(entry.grossPay)-cents(entry.deductions),cents(entry.netPay));
      assert.ok(cents(entry.grossPay)>BigInt(0)&&cents(entry.netPay)>BigInt(0));
      const trace=entry.trace as any;
      assert.equal(trace?.payableTime?.mode,"calendar-segmented");
      const own=new Set(sources.filter(s=>s.employeeId===entry.employeeId&&
        s.workDate>=period.start&&s.workDate<=period.end).map(s=>s.id));
      assert.ok(own.size>0);
      assert.ok(trace.payableTime.segments.some((s:any)=>own.has(Number(s.punchId))&&Number(s.minutes)>0),
        "Missing payroll trace to specific historical worker attendance");
      assert.ok(trace.workforceSchedule?.days?.some((d:any)=>Number(d.patternId)===patternId));
    }
    assert.equal(centsTotal("grossPay"),cents(calc.run.grossPay));
    assert.equal(centsTotal("netPay"),cents(calc.run.netPay));
    const slips=await db.select().from(payslips).where(eq(payslips.organizationId,org.id));
    const forRun=slips.filter(x=>entries.some(e=>e.id===x.payrollEntryId));
    assert.equal(forRun.length,COUNT,"Every worker needs a stored payslip");
    assert.deepEqual(new Set(forRun.map(x=>x.employeeId)),new Set(people));
    const review=await sessions.payroll.ok("/api/payroll-runs/"+runId+"/submit-review","POST",{
      approverUserId:checker.id,
    });
    assert.ok(Number(review.task?.id)>0);
    assert.equal((await sessions.payroll.json("/api/approvals/"+review.task.id,"PATCH",
      {status:"Approved"})).status,403,"Maker must not self-review");
    await sessions.checker.ok("/api/approvals/"+review.task.id,"PATCH",{status:"Approved"});
    assert.equal((await sessions.checker.json("/api/payroll-runs/"+runId+"/release","POST",
      {acknowledgeExceptions:false})).status,403);
    assert.equal((await sessions.owner.ok("/api/payroll-runs/"+runId+"/release-checklist")).ready,true);
    const released=await sessions.owner.ok("/api/payroll-runs/"+runId+"/release","POST",
      {acknowledgeExceptions:false});
    assert.equal(Number(released.receipt?.employeeCount),COUNT);
    assert.equal(released.receipt?.bankExport?.status,"waiting");
    assert.equal((await sessions.owner.json("/api/payroll-runs/"+runId+"/release","POST",
      {acknowledgeExceptions:false})).status,409,"Duplicate run release must be denied");
    const [stored]=await db.select().from(payrollRuns).where(eq(payrollRuns.id,runId));
    assert.equal(stored.status,"Released");
    assert.equal(cents(stored.grossPay),centsTotal("grossPay"));
    assert.equal(cents(stored.netPay),centsTotal("netPay"));
    const journal=await sessions.owner.request("/api/payroll-runs/"+runId+"/exports?kind=journal");
    assert.equal(journal.status,200);assert.match(journal.headers.get("cache-control")??"",/\bno-store\b/);
    const [header,...rows]=parseCsv(await journal.text());
    assert.equal(header[9],"Debit");assert.equal(header[10],"Credit");
    const total=(col:number)=>rows.reduce((n,row)=>n+cents(row[col]||"0"),BigInt(0));
    assert.equal(total(9),total(10),"GL debits and credits do not balance");
    assert.equal(rows.filter(row=>row[8]==="Cash/Bank")
      .reduce((n,row)=>n+cents(row[10]||"0")-cents(row[9]||"0"),BigInt(0)),centsTotal("netPay"));
    // These four forms are MONTHLY, not per-cutoff. Enforce the production
    // final-cutoff guard on period 1, then prove the period-2 monthly summaries
    // cover both released runs without falsely producing eight filing records.
    const forms=[{agency:"BIR",form:"1601-C"},{agency:"SSS",form:"R-3"},
      {agency:"PhilHealth",form:"RF-1"},{agency:"Pag-IBIG",form:"MCRF"}];
    const hashes:Record<string,string>={};
    const finalCutoff=period.end===end;
    if(!finalCutoff){
      for(const form of forms){
        const premature=await sessions.payroll.json("/api/compliance/filing-validations","POST",
          {organizationId:org.id,runId,...form});
        assert.equal(premature.status,422,
          "Monthly statutory draft must not be generated from an incomplete month");
        assert.match(String(premature.body?.error??""),/final.*cutoff/i);
      }
      assert.equal((await db.select().from(governmentFilingValidations)
        .where(eq(governmentFilingValidations.payrollRunId,runId))).length,0,
        "Denied first-cutoff attempts must not persist filing evidence");
    }else{
      for(const form of forms){
        const made=await sessions.payroll.ok("/api/compliance/filing-validations","POST",
          {organizationId:org.id,runId,...form});
        assert.equal(made.record?.status,"generated");
        assert.equal(Number(made.record?.payrollRunId),runId);
        assert.equal(Number(made.record?.employeeCount),COUNT,
          "Monthly statutory worksheet must contain all ten workers");
        const file=await sessions.payroll.request("/api/compliance/filing-validations/"+made.record.id+
          "/file?organizationId="+org.id);
        assert.equal(file.status,200);
        const bytes=Buffer.from(await file.arrayBuffer());
        const body=bytes.toString("utf8");
        assert.match(body,/DRAFT ONLY, not a certified government submission file/);
        if(form.agency==="BIR"){
          const rows=parseCsv(body.split(/\r?\n/).filter(line=>!line.startsWith("#")).join("\n"));
          assert.equal(rows.length,2);
          assert.equal(rows[0][4],"PayrollRunsIncluded");
          assert.equal(rows[1][4],"2",
            "BIR monthly withholding must aggregate both released semimonthly cutoffs");
        }
        const hash=createHash("sha256").update(bytes).digest("hex");
        assert.equal(hash,made.record.fileSha256);assert.equal(file.headers.get("x-filing-sha256"),hash);
        hashes[form.agency]=hash;hashesSeen.add(hash);
      }
      assert.equal((await db.select().from(governmentFilingValidations)
        .where(eq(governmentFilingValidations.payrollRunId,runId))).length,4);
    }
    assert.equal((await db.select({id:payoutBatches.id}).from(payoutBatches)
      .where(eq(payoutBatches.organizationId,org.id))).length,0,"No payout batches");
    assert.equal((await db.select({id:payoutTransfers.id}).from(payoutTransfers)
      .where(eq(payoutTransfers.organizationId,org.id))).length,0,"No payout transfers");
    report.periods.push({periodStart:period.start,periodEnd:period.end,
      syntheticRunId:runId,workerCount:COUNT,approvedTimesheets:cards.length,
      entries:entries.length,storedPayslips:forRun.length,
      sourceTraceChecks:entries.length,centavoLedgerReconciled:true,
      journalBalanced:true,noMoney:true,monthlyFilingEvidence:finalCutoff
        ?"FOUR_DRAFTS_AFTER_FINAL_CUTOFF":"EARLY_MONTHLY_DRAFTS_REJECTED",
      draftSha256:hashes});
  }
  assert.equal(report.periods.length,2);assert.equal(hashesSeen.size,4,
    "Exactly four monthly draft files are required after the final cutoff");
  assert.notEqual(report.periods[0].syntheticRunId,report.periods[1].syntheticRunId);
  report.status="PASS";
}
main().catch(e=>{
  report.status="FAIL";report.errorCategory=e instanceof Error?e.name.slice(0,30):"Unknown";
  console.error("TEN_WORKER_TWO_PERIOD_BLOCKED:",e instanceof Error?e.message.slice(0,260):"unknown");
  process.exitCode=1;
}).finally(async()=>{
  mkdirSync("qa-artifacts",{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log("TEN_WORKER_TWO_PERIOD="+report.status+"; synthetic only; independent review NOT_RUN");
  await pool.end();
});
