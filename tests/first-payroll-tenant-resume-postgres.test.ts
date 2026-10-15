import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

const isolated = (() => {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true" ||
      process.env.HRIS_JOURNEY_ACCEPTANCE_MODE !== "synthetic-postgres-only") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/app_db";
  } catch { return false; }
})();

test("disposable PG16: owner -> HR -> payroll resume, ready preview, zero payroll writes", { skip: !isolated }, async () => {
  const { db } = await import("../src/db");
  const { organizations, users, userOrganizations, legalEntities, employees, employeePayProfiles,
    firstPayrollJourneyProgress, auditEvents, payrollRuns, payrollEntries, payslips } =
    await import("../src/db/schema");
  const { ensurePrimaryLegalEntity } = await import("../src/lib/legal-entity");
  const { saveJourneyProgress, readJourneyProgress } = await import("../src/lib/first-payroll-progress");
  const { loadReadOnlyFirstPayrollPreview } = await import("../src/lib/first-payroll-preview");
  const { loadCanonicalFirstPayrollPreview } = await import("../src/lib/first-payroll-canonical-preview");
  const { encryptBankAccount } = await import("../src/lib/bank-account-crypto");
  const { encryptGovernmentId } = await import("../src/lib/government-id-crypto");

  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db.insert(organizations).values({
    name: "Disposable First Payroll " + suffix, legalName: "Disposable First Payroll " + suffix,
    payrollCalendarMode: "ph_semi_monthly",
  }).returning({ id: organizations.id });
  try {
    const people = await db.insert(users).values(["owner","hr","payroll","checker","bookkeeper"].map(role => ({
      email: `first-payroll-${role}-${suffix}@example.test`,
      name: "Synthetic " + role, role, passwordHash: "synthetic-do-not-login",
    }))).returning({ id: users.id, name: users.name, role: users.role });
    await db.insert(userOrganizations).values(people.map(person => ({
      userId: person.id, organizationId: tenant.id, role: person.role, active: true,
    })));
    const [owner, hr, payroll, checker, finance] = people;
    const employer = await ensurePrimaryLegalEntity(tenant.id, owner.id);
    assert.ok(employer?.id);
    assert.equal(employer?.payrollCalendarMode, "ph_semi_monthly");

    assert.equal(await readJourneyProgress(tenant.id), null);
    await saveJourneyProgress({ organizationId:tenant.id, userId:owner.id, userName:owner.name,
      role:"owner",key:"company",action:"company_confirm" });
    await saveJourneyProgress({ organizationId:tenant.id, userId:owner.id, userName:owner.name,
      role:"owner",key:"time",action:"handoff",targetRole:"hr" });
    const hrResume = await readJourneyProgress(tenant.id);
    assert.equal(hrResume?.stepOwners.time, "hr");
    assert.equal(hrResume?.completedSteps.company.byUserId, owner.id);
    await assert.rejects(saveJourneyProgress({ organizationId:tenant.id,
      userId:owner.id,userName:owner.name,role:"owner",key:"time",action:"time_review",
      periodStart:"2026-10-01",periodEnd:"2026-10-15",acknowledged:true }), /HR/);
    await saveJourneyProgress({ organizationId:tenant.id, userId:hr.id, userName:hr.name,
      role:"hr",key:"time",action:"time_review",periodStart:"2026-10-01",
      periodEnd:"2026-10-15",acknowledged:true });
    const payrollResume = await readJourneyProgress(tenant.id);
    assert.equal(payrollResume?.completedSteps.company.byUserId, owner.id);
    assert.equal(payrollResume?.completedSteps.time.byUserId, hr.id);
    assert.equal(payrollResume?.completedSteps.time.periodEnd, "2026-10-15");
    await assert.rejects(saveJourneyProgress({
      organizationId:tenant.id, userId:checker.id,userName:checker.name,role:"checker",
      key:"payroll",action:"handoff",targetRole:"bookkeeper",
    }),/responsible role|administrator/);
    await saveJourneyProgress({
      organizationId:tenant.id, userId:payroll.id,userName:payroll.name,role:"payroll",
      key:"payroll",action:"handoff",targetRole:"bookkeeper",
    });
    assert.equal((await readJourneyProgress(tenant.id))?.stepOwners.payroll,"bookkeeper");
    const financeResume = await readJourneyProgress(tenant.id);
    assert.equal(financeResume?.completedSteps.time.byUserId, hr.id);
    assert.equal(finance?.role, "bookkeeper");

    const [person] = await db.insert(employees).values({
      organizationId:tenant.id, legalEntityId:employer!.id,
      employeeNo:"FP-0001", firstName:"Synthetic", lastName:"Worker", title:"Staff",
      avatarInitials:"SW", basicRate:"30000.00", status:"Active", region:"NCR",
      restDay:"Sunday", startDate:"2026-01-01", mwe:false,
      tin:encryptGovernmentId("123456789"), bankCode:"BPI",
      bankAccount:encryptBankAccount("synthetic-00001234"),
    }).returning({ id: employees.id });
    await db.insert(employeePayProfiles).values({ organizationId:tenant.id, employeeId:person.id,
      payBasis:"monthly",rateAmount:"30000.00",standardWorkDaysPerMonth:"22.00",standardHoursPerDay:"8.00" });

    const snapshot = async () => ({
      progress:(await db.select().from(firstPayrollJourneyProgress)
        .where(eq(firstPayrollJourneyProgress.organizationId,tenant.id))),
      runs:(await db.select({id:payrollRuns.id}).from(payrollRuns)
        .where(eq(payrollRuns.organizationId,tenant.id))),
      entries:(await db.select({id:payrollEntries.id}).from(payrollEntries)),
      payslips:(await db.select({id:payslips.id}).from(payslips)),
      audit:(await db.select().from(auditEvents).where(eq(auditEvents.organizationId,tenant.id))),
    });
    const before = await snapshot();
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      return loadReadOnlyFirstPayrollPreview({
        organizationId:tenant.id,periodStart:"2026-10-01",
        periodEnd:"2026-10-15",payDate:"2026-10-15",
      }, tx as unknown as Pick<typeof db,"select">);
    });
    const canonicalResult = await db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
      return loadCanonicalFirstPayrollPreview({
        organizationId: tenant.id, periodStart: "2026-10-01",
        periodEnd: "2026-10-15", payDate: "2026-10-15",
      }, tx as unknown as Pick<typeof db, "select">);
    });
    assert.equal(canonicalResult.dryRun, true);
    assert.equal(canonicalResult.persisted, false);
    assert.equal(canonicalResult.previewReady, true, JSON.stringify(canonicalResult.blockers));
    assert.equal(canonicalResult.rows.length, 1);
    assert.equal(canonicalResult.rows[0].gross, result.rows[0].gross);
    assert.equal(canonicalResult.rows[0].net, result.rows[0].net);
    const after = await snapshot();
    assert.deepEqual(after,before,"Read-only preview must leave payroll, payslips, progress and audit unchanged");
    assert.equal(result.dryRun,true);
    assert.equal(result.persisted,false);
    assert.equal(result.rows.length,1);
    assert.equal(result.previewReady,true,JSON.stringify(result.blockers));
    assert.ok((result.rows[0].gross??0)>0);
    assert.ok((result.rows[0].net??0)>=0);
    assert.equal((await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId,tenant.id))).length,0);
    assert.equal((await db.select().from(payrollEntries)).length,before.entries.length);
    assert.equal(payroll.role,"payroll");
  } finally {
    await db.delete(employees).where(eq(employees.organizationId,tenant.id));
    await db.delete(organizations).where(eq(organizations.id,tenant.id));
  }
});


test("disposable PG16: five-worker canonical parity versus a no-release payroll run", {skip: !isolated}, async () => {
  const {db} = await import("../src/db");
  const {organizations,users,userOrganizations,employees,employeePayProfiles,
    timePunches,workforceTimesheets,overtimeRequests,leavePolicies,leaveRequests,
    holidays,employeeLoans,supplementaryEarnings,payrollRuns,payrollEntries,payslips,auditEvents}
    = await import("../src/db/schema");
  const {ensurePrimaryLegalEntity} = await import("../src/lib/legal-entity");
  const {saveJourneyProgress} = await import("../src/lib/first-payroll-progress");
  const {encryptBankAccount} = await import("../src/lib/bank-account-crypto");
  const {encryptGovernmentId} = await import("../src/lib/government-id-crypto");
  const {hashTimesheetSnapshot} = await import("../src/lib/workforce-timesheet");
  const {loadCanonicalFirstPayrollPreview} = await import("../src/lib/first-payroll-canonical-preview");
  const {enqueuePayrollRun,drainPayrollQueue,PAYROLL_RULE_VERSION} = await import("../src/lib/payroll-engine");
  const {formatPayrollPeriodLabel} = await import("../src/lib/payroll-period-ui");
  const suffix=randomUUID().slice(0,8), start="2026-10-01", end="2026-10-15";
  const [orgA,orgB]=await db.insert(organizations).values([
    {name:"Canonical A "+suffix,legalName:"Canonical A "+suffix,payrollCalendarMode:"ph_semi_monthly"},
    {name:"Canonical B "+suffix,legalName:"Canonical B "+suffix,payrollCalendarMode:"ph_semi_monthly"},
  ]).returning({id:organizations.id});
  try {
    const actors=await db.insert(users).values(["owner","hr","payroll","checker"].map(role=>({
      email:"canonical-"+role+"-"+suffix+"@example.test",
      name:"Fictional "+role,role,passwordHash:"synthetic-no-login",
    }))).returning({id:users.id,role:users.role,name:users.name});
    await db.insert(userOrganizations).values(actors.map(actor=>({
      organizationId:orgA.id,userId:actor.id,role:actor.role,active:true,
    })));
    await db.insert(userOrganizations).values({
      organizationId:orgB.id,userId:actors[0].id,role:"owner",active:true,
    });
    const legalA=await ensurePrimaryLegalEntity(orgA.id,actors[0].id);
    const legalB=await ensurePrimaryLegalEntity(orgB.id,actors[0].id);
    assert.ok(legalA?.id&&legalB?.id);
    await saveJourneyProgress({organizationId:orgA.id,userId:actors[0].id,
      userName:actors[0].name,role:"owner",key:"company",action:"company_confirm"});
    await saveJourneyProgress({organizationId:orgA.id,userId:actors[0].id,
      userName:actors[0].name,role:"owner",key:"time",action:"handoff",targetRole:"hr"});
    await saveJourneyProgress({organizationId:orgA.id,userId:actors[1].id,
      userName:actors[1].name,role:"hr",key:"time",action:"time_review",
      periodStart:start,periodEnd:end,acknowledged:true});
    const baseEmployee={
      employeeNo:"DUPLICATE-1",firstName:"Fictional",lastName:"Worker",
      title:"Staff",avatarInitials:"FW",basicRate:"30000.00",
      status:"Active",region:"NCR",restDay:"Sunday",startDate:"2026-01-01",
      mwe:false,tin:encryptGovernmentId("123456789"),
      bankCode:"BPI",bankAccount:encryptBankAccount("synthetic-00001234"),
    } as const;
    const workers=await db.insert(employees).values(
      Array.from({length:5},(_,i)=>({
        ...baseEmployee,organizationId:orgA.id,legalEntityId:legalA!.id,
        employeeNo:"DUPLICATE-"+(i+1),lastName:"Worker "+(i+1),
      })),
    ).returning({id:employees.id});
    await db.insert(employees).values({...baseEmployee,organizationId:orgB.id,legalEntityId:legalB!.id});
    await db.insert(employeePayProfiles).values(workers.map((worker,i)=>({
      organizationId:orgA.id,employeeId:worker.id,
      payBasis:i===1?"daily":i===2?"hourly":"monthly",
      rateAmount:i===1?"950.00":i===2?"120.00":"30000.00",
      standardWorkDaysPerMonth:"22",standardHoursPerDay:"8",
    })));
    await db.insert(timePunches).values([
      {organizationId:orgA.id,employeeId:workers[1].id,workDate:"2026-10-07",
        timeIn:new Date("2026-10-07T09:00:00+08:00"),
        timeOut:new Date("2026-10-07T18:00:00+08:00"),
        shiftStart:"09:00",shiftEnd:"18:00",status:"Complete"},
      {organizationId:orgA.id,employeeId:workers[2].id,workDate:"2026-10-08",
        timeIn:new Date("2026-10-08T09:00:00+08:00"),
        timeOut:new Date("2026-10-08T20:00:00+08:00"),
        shiftStart:"09:00",shiftEnd:"18:00",status:"Complete"},
    ]);
    await db.insert(overtimeRequests).values({
      organizationId:orgA.id,employeeId:workers[2].id,workDate:"2026-10-08",
      requestedMinutes:120,reason:"Synthetic OT",requestKind:"pre_approved",
      status:"approved",requestedBy:"Fictional HR",requestedByUserId:actors[1].id,
      decidedBy:"Fictional checker",decidedByUserId:actors[3].id,
    });
    await db.insert(workforceTimesheets).values([workers[1],workers[2]].map(worker=>({
      organizationId:orgA.id,employeeId:worker.id,periodStart:start,periodEnd:end,
      status:"approved",version:1,snapshot:{},snapshotHash:hashTimesheetSnapshot({}),
    })));
    await db.insert(leavePolicies).values({
      organizationId:orgA.id,leaveType:"Vacation",annualDays:"15",
      payTreatment:"paid",paidPercentage:"100",active:true,
    });
    await db.insert(leaveRequests).values({
      organizationId:orgA.id,employeeId:workers[3].id,leaveType:"Vacation",
      startDate:"2026-10-09",endDate:"2026-10-09",days:"1",
      status:"Approved",reason:"Synthetic leave",
    });
    await db.insert(holidays).values({organizationId:orgA.id,
      holidayDate:"2026-10-10",name:"Fictional Local Holiday",kind:"regular"});
    await db.insert(employeeLoans).values({
      organizationId:orgA.id,employeeId:workers[4].id,loanType:"Company Emergency Loan",
      referenceNo:"SYNTHETIC-LOAN",principal:"3000",monthlyAmortization:"500",
      cutoffDeduction:"250",remainingBalance:"2000",status:"active",
      requestedByUserId:actors[1].id,reviewedByUserId:actors[3].id,
      deductionAuthorizationReference:"SYNTHETIC-APPROVAL-REFERENCE",
    });
    await db.insert(supplementaryEarnings).values({
      organizationId:orgA.id,employeeId:workers[4].id,earningType:"allowance",
      label:"Synthetic allowance",amount:"500",taxable:true,
      includeInSssBase:true,includeInPagIbigBase:true,effectiveDate:end,status:"approved",
    });
    const countRuns=async()=> (await db.select({id:payrollRuns.id}).from(payrollRuns)
      .where(eq(payrollRuns.organizationId,orgA.id))).length;
    const countSlips=async()=> (await db.select({id:payslips.id}).from(payslips)
      .where(eq(payslips.organizationId,orgA.id))).length;
    const countAudit=async()=> (await db.select({id:auditEvents.id}).from(auditEvents)
      .where(eq(auditEvents.organizationId,orgA.id))).length;
    const before=[await countRuns(),await countSlips(),await countAudit()];
    const preview=await db.transaction(async tx=>{
      await tx.execute(sql.raw("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"));
      return loadCanonicalFirstPayrollPreview({organizationId:orgA.id,
        periodStart:start,periodEnd:end,payDate:end},tx as unknown as Pick<typeof db,"select">);
    });
    assert.equal(preview.persisted,false);
    assert.equal(preview.rows.length,5,"second employer with overlapping employeeNo cannot leak");
    assert.equal(preview.previewReady,true,
      JSON.stringify(preview.blockers)+JSON.stringify(preview.rows.map(row=>row.blockers)));
    assert.ok(preview.rows.every(row=>row.gross!==null&&row.net!==null));
    assert.deepEqual([await countRuns(),await countSlips(),await countAudit()],before,
      "read-only preview must not create payroll, payslip or audit records");
    const [run]=await db.insert(payrollRuns).values({
      organizationId:orgA.id,legalEntityId:legalA!.id,periodLabel:formatPayrollPeriodLabel(start,end),
      periodStart:start,periodEnd:end,payDate:end,status:"Draft",
      scopeLabel:"All locations",ruleVersion:PAYROLL_RULE_VERSION,
    }).returning({id:payrollRuns.id});
    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10,run.id);
    const entries=await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId,run.id));
    assert.equal(entries.length,5);
    for(const projected of preview.rows){
      const entry=entries.find(item=>item.employeeId===projected.employeeId);
      assert.ok(entry);
      assert.equal(Number(entry.grossPay).toFixed(2),projected.gross!.toFixed(2));
      assert.equal(Number(entry.netPay).toFixed(2),projected.net!.toFixed(2));
      const lines=Array.isArray(entry.lineItems)?entry.lineItems as Array<{code?:string;amount?:string|number}>:[];
      for(const [code,amount] of [["SSS",projected.sss],["PHIC",projected.philHealth],
        ["HDMF",projected.pagIbig],["WHT",projected.withholding]] as const){
        const deduction=Math.abs(Number(lines.find(line=>line.code===code)?.amount??0));
        assert.equal(deduction.toFixed(2),amount!.toFixed(2),code);
      }
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id,orgA.id));
    await db.delete(organizations).where(eq(organizations.id,orgB.id));
  }
});
