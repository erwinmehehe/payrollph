import assert from "node:assert/strict";
import test from "node:test";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { db } from "../src/db";

test("canonical read-only projection assembles five workers without issuing a write", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { projectCanonicalPayrollReadOnly, calculateEmployeePay } =
    await import("../src/lib/payroll-engine");
  const { statutoryRuleVersionsForDate } = await import("../src/lib/ph-statutory-rule-packs");
  const { nationalHolidayCalendarForDate } = await import("../src/lib/wage-orders");
  const { formatPayrollPeriodLabel } = await import("../src/lib/payroll-period-ui");
  const start = "2026-10-01", end = "2026-10-15", payDate = "2026-10-15", org = 303, legalId = 808;
  const people = Array.from({length:5}, (_,index)=>({
    id:index+1, organizationId:org, legalEntityId:legalId, status:"Active", startDate:"2026-01-01",
    orgUnitId:null, employeeNo:"FICTIONAL-"+(index+1), firstName:"Fictional",
    lastName:"Employee"+(index+1), basicRate:"30000.00", region:"NCR", mwe:false,
    restDay:"Sunday", pagIbigVoluntaryMonthly:"0", tin:"123456789", bankAccount:"synthetic", bankCode:"TEST",
  }));
  const profiles = people.map(worker=>({
    id:worker.id+10, organizationId:org, employeeId:worker.id,
    payBasis:worker.id===2?"daily":worker.id===3?"hourly":"monthly",
    rateAmount:worker.id===2?"950.00":worker.id===3?"120.00":"30000.00",
    standardWorkDaysPerMonth:"22.00", standardHoursPerDay:"8.00",
  }));
  const punches=[
    {id:21, organizationId:org, employeeId:2, workDate:"2026-10-07",
      timeIn:new Date("2026-10-07T01:00:00Z"),timeOut:new Date("2026-10-07T10:00:00Z"),
      shiftStart:"09:00",shiftEnd:"18:00",breakStart:null,breakEnd:null,status:"Complete"},
    {id:22, organizationId:org, employeeId:3, workDate:"2026-10-08",
      timeIn:new Date("2026-10-08T01:00:00Z"),timeOut:new Date("2026-10-08T12:00:00Z"),
      shiftStart:"09:00",shiftEnd:"18:00",breakStart:null,breakEnd:null,status:"Complete"},
  ];
  const fixtures:Record<string,unknown[]>={
    organizations:[{id:org,name:"Fictional Employer",legalName:"Fictional Employer",statutoryDeductionTiming:"split"}],
    legal_entities:[{id:legalId,organizationId:org,active:true,primaryEntity:true,
      statutoryDeductionTiming:"split",payrollCalendarMode:"ph_semi_monthly"}],
    employees:people,
    employee_pay_profiles:profiles,
    time_punches:punches,
    leave_policies:[{id:1,organizationId:org,active:true,leaveType:"Vacation",
      payTreatment:"paid",paidPercentage:"100"}],
    leave_requests:[{id:49,organizationId:org,employeeId:4,
      status:"Approved",leaveType:"Vacation",startDate:"2026-10-09",endDate:"2026-10-09",days:"1"}],
    employee_loans:[{id:60,organizationId:org,employeeId:5,status:"active",
      remainingBalance:"2000.00",cutoffDeduction:"250.00",
      loanType:"Company Emergency Loan",referenceNo:"FICTIONAL",startDate:"2026-01-01",endDate:null}],
    benefit_plans:[{id:201,active:true,name:"Fictional Wellness Benefit",category:"hmo",
      employeeShare:"250.00",employerShare:"500.00",cap:null}],
    benefit_enrollments:[{id:202,organizationId:org,employeeId:5,planId:201,status:"active",
      monthlyContribution:"100.00"}],
    employee_compensation_components:[{assignmentId:203,employeeId:5,amount:"200.00",
      effectiveFrom:"2026-09-01",effectiveUntil:null,status:"active",componentId:204,
      componentCode:"ALLOWANCE",componentName:"Fictional Recurring Allowance",
      kind:"allowance",amountFrequency:"per_cutoff",taxable:true,
      includeInSssBase:true,includeInPagIbigBase:true}],
    supplementary_earnings:[{id:61,organizationId:org,employeeId:5,status:"approved",
      payrollRunId:null,effectiveDate:"2026-10-15",amount:"500.00",earningType:"allowance",
      label:"Approved Allowance",taxable:true,includeInSssBase:true,includeInPagIbigBase:true}],
  };
  const dialect=new PgDialect();
  let reads=0, writes=0, punchQueries=0;
  const reader=new Proxy({select(){
    reads++;
    let table="",condition:SQL|undefined;
    const q:Record<string,unknown>={};
    q.from=(t:Parameters<typeof getTableName>[0])=>{table=getTableName(t);return q;};
    q.where=(value:SQL)=>{condition=value;return q;};
    q.orderBy=()=>q;q.leftJoin=()=>q;q.innerJoin=()=>q;q.limit=()=>q;q.groupBy=()=>q;
    q.then=(done:(rows:unknown[])=>unknown)=>{
      if(table==="time_punches"){
        assert.ok(condition,"punch query must have explicit worker and tenant scope");
        const compiled=dialect.sqlToQuery(condition);
        assert.match(compiled.sql,/organization_id/);
        assert.match(compiled.sql,/employee_id/);
        assert.match(compiled.sql,/work_date/);
        punchQueries++;
        const match=compiled.sql.match(/employee_id" = \$(\d+)/);
        const id=match?Number(compiled.params[Number(match[1])-1]):null;
        return Promise.resolve(punches.filter(p=>id===null||p.employeeId===id)).then(done);
      }
      return Promise.resolve(fixtures[table]??[]).then(done);
    };
    return q;
  }},{get(target,prop){
    if(prop==="select")return target.select;
    writes++;throw Error("Preview attempted a database write");
  }}) as unknown as Pick<typeof db,"select">;
  const before=structuredClone(fixtures);
  const result=await projectCanonicalPayrollReadOnly({
    organizationId:org,legalEntityId:legalId,periodStart:start,periodEnd:end,
    payDate,employeeCount:people.length,employeeIds:people.map(e=>e.id),
  },reader);
  assert.equal(writes,0);
  assert.deepEqual(fixtures,before);
  assert.ok(reads>30);
  assert.ok(punchQueries>=2);
  assert.deepEqual(result.map(x=>x.employeeId),[1,2,3,4,5]);
  assert.ok(result.every(x=>x.gross===null||Number.isFinite(x.gross)));
  assert.ok(result.every(x=>x.net===null||Number.isFinite(x.net)));
  const ordinary=calculateEmployeePay({
    employee:people[0] as Parameters<typeof calculateEmployeePay>[0]["employee"],
    punches:[],advisories:[],unitName:"Unassigned",
    periodLabel:formatPayrollPeriodLabel(start,end),
    payProfile:{payBasis:"monthly",rateAmount:"30000.00",
      standardWorkDaysPerMonth:"22.00",standardHoursPerDay:"8.00"},
    statutoryDeductionTiming:"split",periodStart:start,periodEnd:end,payDate,
    statutoryRuleVersions:statutoryRuleVersionsForDate(payDate),
    holidayCalendar:nationalHolidayCalendarForDate(end),isFinalCutoffOfMonth:false,
  });
  assert.equal(result[0].gross,ordinary.gross);
  assert.equal(result[0].net,ordinary.net);
  // The real payroll worker calls exactly this calculator with the same
  // assembled loan, benefit, recurring compensation and supplementary inputs.
  // No test database or provider is involved.
  const fullInputs: Parameters<typeof calculateEmployeePay>[0] = {
    employee:people[4] as Parameters<typeof calculateEmployeePay>[0]["employee"],
    punches:[],advisories:[],unitName:"Unassigned",periodLabel:formatPayrollPeriodLabel(start,end),
    payProfile:{payBasis:"monthly",rateAmount:"30000.00",
      standardWorkDaysPerMonth:"22.00",standardHoursPerDay:"8.00"},
    periodStart:start,periodEnd:end,payDate,
    statutoryRuleVersions:statutoryRuleVersionsForDate(payDate),
    statutoryDeductionTiming:"split",holidayCalendar:nationalHolidayCalendarForDate(end),
    isFinalCutoffOfMonth:false,
    loans:[{id:60,loanType:"Company Emergency Loan",referenceNo:"FICTIONAL",
      cutoffDeduction:250,remainingBalance:2000}],
    supplementaryEarnings:[
      {id:61,earningType:"allowance",label:"Approved Allowance",amount:500,
        taxable:true,includeInSssBase:true,includeInPagIbigBase:true},
      {id:203,code:"COMP-203",earningType:"recurring_allowance",
        label:"Fictional Recurring Allowance",amount:200,taxable:true,
        includeInSssBase:true,includeInPagIbigBase:true,
        notes:["Recurring component ALLOWANCE","Frequency: per_cutoff",
          "Effective 2026-09-01"]},
    ],
    benefits:[{plan:{id:201,name:"Fictional Wellness Benefit",category:"hmo",
      employeeShare:250,employerShare:500,cap:null},monthlyContribution:100,active:true}],
  };
  const realWorkerCalc=calculateEmployeePay(fullInputs);
  assert.equal(realWorkerCalc.status,"Ready","fictional approved inputs should be complete");
  const projected=result[4];
  assert.equal(projected.gross,realWorkerCalc.gross,"gross equals the real calculator exactly");
  assert.equal(projected.net,realWorkerCalc.net,"net equals the real calculator exactly");
  const realStatutory=Math.round(realWorkerCalc.lineItems
    .filter(line=>["SSS","PHIC","HDMF","WHT"].includes(line.code)||line.code.startsWith("YE-TAX"))
    .reduce((sum,line)=>sum-Number(line.amount),0)*100)/100;
  assert.equal(projected.statutoryDeductions,realStatutory);
  assert.equal(projected.otherDeductions,
    Math.round((realWorkerCalc.deductions-realStatutory)*100)/100);
  assert.equal(Math.round((projected.gross! - projected.statutoryDeductions! -
    projected.otherDeductions!)*100),Math.round(projected.net!*100));
  for(const [page,recordId] of [
    ["Loans",60],["Payroll",61],["Benefits",202],["Compensation",203],
  ] as const){
    assert.ok(projected.sources.some(source=>source.page===page&&source.recordId===recordId),
      page+" approved source must be linked");
  }
  assert.equal(projected.blockers.length,0);
});

test("canonical no-write projection rejects bad cohort without reading database",async()=>{
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const {projectCanonicalPayrollReadOnly}=await import("../src/lib/payroll-engine");
  let reads=0;
  const reader={select(){reads++;throw Error("Unexpected read");}} as unknown as Pick<typeof db,"select">;
  await assert.rejects(projectCanonicalPayrollReadOnly({
    organizationId:33,legalEntityId:100,periodStart:"2026-10-01",periodEnd:"2026-10-15",
    payDate:"2026-10-15",employeeCount:1,employeeIds:[9,9],
  },reader),/invalid|exceeds/);
  assert.equal(reads,0);
});

test("incomplete payroll source produces worker-specific blockers and never guesses net", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const {projectCanonicalPayrollReadOnly}=await import("../src/lib/payroll-engine");
  const organizationId=707,legalEntityId=808;
  const workers=[301,302].map(id=>({
    id,organizationId,legalEntityId,status:"Active",startDate:"2026-01-01",
    orgUnitId:null,employeeNo:"FICTIONAL-"+id,firstName:"Fictional",lastName:"Worker"+id,
    basicRate:"30000.00",region:"NCR",mwe:false,restDay:"Sunday",
    pagIbigVoluntaryMonthly:"0",tin:"123456789",bankAccount:"fake",bankCode:"TEST",
  }));
  const fixtures:Record<string,unknown[]>={
    organizations:[{id:organizationId,name:"Fictional Employer",statutoryDeductionTiming:"split"}],
    legal_entities:[{id:legalEntityId,organizationId,active:true,primaryEntity:true,
      statutoryDeductionTiming:"split"}],
    employees:workers,
    employee_pay_profiles:[{id:1001,employeeId:301,organizationId,payBasis:"monthly",
      rateAmount:"30000.00",standardWorkDaysPerMonth:"22.00",standardHoursPerDay:"8.00"}],
  };
  let writes=0;
  const reader=new Proxy({select(){
    let table="";
    const query:Record<string,unknown>={};
    query.from=(target:Parameters<typeof getTableName>[0])=>{table=getTableName(target);return query;};
    query.where=()=>query;query.orderBy=()=>query;query.limit=()=>query;query.groupBy=()=>query;
    query.innerJoin=()=>query;query.leftJoin=()=>query;
    query.then=(done:(rows:unknown[])=>unknown)=>Promise.resolve(fixtures[table]??[]).then(done);
    return query;
  }},{get(target,property){
    if(property==="select")return target.select;
    writes++;throw Error("Canonical preview attempted a write");
  }}) as unknown as Pick<typeof db,"select">;
  const rows=await projectCanonicalPayrollReadOnly({
    organizationId,legalEntityId,periodStart:"2026-10-01",periodEnd:"2026-10-15",
    payDate:"2026-10-15",employeeIds:workers.map(worker=>worker.id),employeeCount:2,
  },reader);
  assert.equal(writes,0);
  assert.equal(rows.length,2);
  assert.ok(rows[0].gross!==null&&rows[0].net!==null,
    "unrelated complete worker remains independently calculable");
  assert.equal(rows[1].gross,null);
  assert.equal(rows[1].statutoryDeductions,null);
  assert.equal(rows[1].otherDeductions,null);
  assert.equal(rows[1].net,null);
  assert.ok(rows[1].blockers.some(message=>message.includes("Missing employee pay profile")));
});
