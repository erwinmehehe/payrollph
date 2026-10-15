import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, employees, payrollRuns, payrollEntries, employeePayRevisions,
  employeePayRetroAdjustments, historicalPayrollEntries, importBatches, yearEndAdjustments } from "../src/db/schema";
import { runYearEndAnnualization } from "../src/lib/year-end";

test("M-5 year-end only counts 2026 original retro basic, not verified 2025 retro paid in 2026", async () => {
  const url = process.env.DATABASE_URL;
  assert.ok(url && ["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname));
  const suffix=randomUUID().slice(0,8);
  const [org] = await db.insert(organizations).values({
    name: "Fictional M5 yearend " + suffix, legalName:"Fictional M5 Year End", plan:"Core",
  }).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId:org.id,employeeNo:"M5-YE-"+suffix,firstName:"Fictional",
      lastName:"Payroll",title:"QA",avatarInitials:"FP",basicRate:"20000.00",startDate:"2025-01-01",
    }).returning();
    const [revision] = await db.insert(employeePayRevisions).values({
      organizationId:org.id,employeeId:worker.id,effectiveDate:"2026-09-01",
      previousPayBasis:"monthly",previousRateAmount:"18000.00",
      previousStandardWorkDaysPerMonth:"22.00",previousStandardHoursPerDay:"8.00",
      newPayBasis:"monthly",newRateAmount:"20000.00",
      newStandardWorkDaysPerMonth:"22.00",newStandardHoursPerDay:"8.00",
      reason:"Fictional effective-dated retro reconciliation",
    }).returning();
    const runs=await db.insert(payrollRuns).values([
      {organizationId:org.id,periodLabel:"ORIGINAL_2025",periodStart:"2025-11-01",periodEnd:"2025-11-15",payDate:"2025-11-15",status:"Released"},
      {organizationId:org.id,periodLabel:"ORIGINAL_2026",periodStart:"2026-02-01",periodEnd:"2026-02-15",payDate:"2026-02-15",status:"Released"},
      {organizationId:org.id,periodLabel:"SETTLEMENT_2026",periodStart:"2026-09-01",periodEnd:"2026-09-15",payDate:"2026-09-15",status:"Released"},
    ]).returning();
    for(const run of runs.slice(0,2)) {
      await db.insert(payrollEntries).values({
        payrollRunId:run.id,employeeId:worker.id,grossPay:"0.00",
        deductions:"0.00",netPay:"0.00",lineItems:[],
      });
    }
    const adjust=await db.insert(employeePayRetroAdjustments).values([
      {organizationId:org.id,employeeId:worker.id,revisionId:revision.id,sourcePayrollRunId:runs[0].id,sourcePeriodLabel:"NOT_A_YEAR",amount:"1200.00"},
      {organizationId:org.id,employeeId:worker.id,revisionId:revision.id,sourcePayrollRunId:runs[1].id,sourcePeriodLabel:"UNTRUSTED",amount:"600.00"},
    ]).returning();
    await db.insert(payrollEntries).values({
      payrollRunId:runs[2].id,employeeId:worker.id,grossPay:"3800.00",
      deductions:"0.00",netPay:"3800.00",
      lineItems:[
        {code:"BASIC",amount:"2000.00"},
        {code:"RETRO-"+adjust[0].id,amount:"1200.00"},
        {code:"RETRO-"+adjust[1].id,amount:"600.00"},
      ],
    });
    const [batch]=await db.insert(importBatches).values({
      organizationId:org.id,fileName:"fictional-2026-register.csv",sourceSystem:"generic",
      importKind:"payroll_history",totalRows:12,createdBy:"Synthetic QA",
    }).returning();
    for(let month=1;month<=12;month++) {
      const mm=String(month).padStart(2,"0");
      const paid=month===12?"20000.00":"0.00";
      await db.insert(historicalPayrollEntries).values({
        organizationId:org.id,employeeId:worker.id,importBatchId:batch.id,sourceSystem:"generic",
        sourceReference:"FICT-2026-"+mm,periodLabel:"2026 "+mm,payDate:"2026-"+mm+"-20",
        grossPay:month===12?"40000.00":"20000.00",basicSalary:"20000.00",
        netPay:month===12?"40000.00":"20000.00",thirteenthMonth:paid,
      });
    }
    const result=await runYearEndAnnualization(org.id,2026,"Fictional QA");
    assert.equal(result.employees,1);
    const [record]=await db.select().from(yearEndAdjustments).where(and(
      eq(yearEndAdjustments.organizationId,org.id),eq(yearEndAdjustments.employeeId,worker.id),
      eq(yearEndAdjustments.taxYear,2026)
    ));
    assert.ok(record);
    const b=record.breakdown as {basicSalaryEarned:number,thirteenthEntitlement:number,thirteenthAlreadyPaid:number,thirteenthStillDue:number};
    assert.equal(b.basicSalaryEarned,242600);
    assert.equal(b.thirteenthEntitlement,20216.67);
    assert.equal(b.thirteenthAlreadyPaid,20000);
    assert.equal(b.thirteenthStillDue,216.67);

    // A new settled adjustment with a Draft original run must fail closed.
    // It cannot silently erase or overwrite a previously reconciled year-end.
    const [draftSource]=await db.insert(payrollRuns).values({
      organizationId:org.id,periodLabel:"INVALID_DRAFT_ORIGINAL",
      periodStart:"2025-10-01",periodEnd:"2025-10-15",payDate:"2025-10-15",status:"Draft",
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId:draftSource.id,employeeId:worker.id,grossPay:"2000.00",
      deductions:"0.00",netPay:"2000.00",lineItems:[{code:"BASIC",amount:"2000.00"}],
    });
    const [invalid]=await db.insert(employeePayRetroAdjustments).values({
      organizationId:org.id,employeeId:worker.id,revisionId:revision.id,
      sourcePayrollRunId:draftSource.id,sourcePeriodLabel:"FALSE_2026",
      amount:"75.25",
    }).returning();
    const [invalidSettlement]=await db.insert(payrollRuns).values({
      organizationId:org.id,periodLabel:"INVALID_SETTLEMENT",
      periodStart:"2026-10-01",periodEnd:"2026-10-15",payDate:"2026-10-15",status:"Released",
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId:invalidSettlement.id,employeeId:worker.id,
      grossPay:"75.25",deductions:"0.00",netPay:"75.25",
      lineItems:[{code:"RETRO-"+invalid.id,amount:"75.25"}],
    });
    await assert.rejects(
      ()=>runYearEndAnnualization(org.id,2026,"Fictional QA"),
      /FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED/,
      "a Draft source must block the year-end recomputation",
    );
    const [unchanged]=await db.select().from(yearEndAdjustments).where(and(
      eq(yearEndAdjustments.organizationId,org.id),eq(yearEndAdjustments.employeeId,worker.id),
      eq(yearEndAdjustments.taxYear,2026),
    ));
    assert.equal(unchanged.id,record.id);
    assert.equal((unchanged.breakdown as { thirteenthEntitlement:number }).thirteenthEntitlement,20216.67);
  } finally {
    await db.delete(organizations).where(eq(organizations.id,org.id));
  }
});
