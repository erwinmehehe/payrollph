/**
 * M-5 no-money acceptance: imported 2025/2026 historical CSV, two independent
 * fictional employers, verified original payroll year and DB maker/checker.
 * This is NOT an authenticated HTTP approval or statutory sign-off.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employeePayRevisions, employeePayRetroAdjustments, employees,
  historicalPayrollEntries, importBatches, organizations, payrollEntries,
  payrollRuns, separationRecords, users, yearEndAdjustments,
} from "../src/db/schema";
import { loadFinalPayRetroSourcePeriods } from "../src/lib/final-pay-retro-source-lookup";
import { retroSourceTaxYear, computeFinalPay } from "../src/lib/final-pay";
import { parseMigrationCsv, type MigratedPayrollHistory } from "../src/lib/migration-import";
import { runYearEndAnnualization } from "../src/lib/year-end";
import { finalPaySourceFingerprint, type FinalPayFingerprintInputs } from "../src/lib/final-pay-source-fingerprint";

const money=(n:number)=>n.toFixed(2);
function csvFor(employeeNo:string,year:number,basic:number,paid13th:number) {
  const head="Employee ID,Pay Date,Payroll Period,Reference,Gross Pay,Basic Salary Earned,Net Pay,Withholding Tax,SSS Contribution,PhilHealth Contribution,Pag-IBIG Contribution,13th Month Pay";
  const rows=[head];
  for(let m=1;m<=12;m++){
    const mm=String(m).padStart(2,"0");
    const paid=m===12?paid13th:0;
    rows.push([employeeNo,`${year}-${mm}-20`,`${year} month ${mm}`,`SYN-${year}-${mm}`,
      money(basic+paid),money(basic),money(basic+paid),"0.00","0.00","0.00","0.00",money(paid)].join(","));
  }
  return rows.join("\n");
}
test("M-5: two tenant CSV history, verified prior-year retro, year-end and separated SQL maker/checker evidence",async()=>{
  const url=process.env.DATABASE_URL;
  assert.ok(url && ["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname),"disposable loopback DB only");
  const seed=randomUUID().slice(0,8);
  const orgs=await db.insert(organizations).values([
    {name:"M5-CSV-A-"+seed,legalName:"FICTIONAL EMPLOYER A",plan:"Core"},
    {name:"M5-CSV-B-"+seed,legalName:"FICTIONAL EMPLOYER B",plan:"Core"},
  ]).returning();
  const actors=await db.insert(users).values([
    {email:`m5-maker-${seed}@example.invalid`,name:"Fictional Maker",passwordHash:"test"},
    {email:`m5-checker-${seed}@example.invalid`,name:"Fictional Checker",passwordHash:"test"},
  ]).returning();
  try{
    const scenarios=[
      {org:orgs[0],id:"FA-HISTORY",monthly2025:30000,monthly2026:20000,paid2025:30000,paid2026:20000,retro2025:1200,expected2025Basic:361200,expectedGap:100,expected2026Basic:242000,expected2026Due:166.67},
      {org:orgs[1],id:"FB-HISTORY",monthly2025:15000,monthly2026:15000,paid2025:15000,paid2026:15000,retro2025:-1200,expected2025Basic:178800,expectedGap:-100,expected2026Basic:182000,expected2026Due:166.67},
    ];
    for (const spec of scenarios){
      const [worker]=await db.insert(employees).values({
        organizationId:spec.org.id,employeeNo:spec.id+seed,firstName:"Fictional",
        lastName:spec.id,title:"QA",avatarInitials:"FQ",
        basicRate:money(spec.monthly2026),startDate:"2025-01-01",
      }).returning();
      for(const [year,basic,paid] of [
        [2025,spec.monthly2025,spec.paid2025],
        [2026,spec.monthly2026,spec.paid2026],
      ] as const){
        const parsed=parseMigrationCsv({source:"generic",kind:"payroll_history",csv:csvFor(worker.employeeNo,year,basic,paid)});
        assert.deepEqual(parsed.errors,[],"CSV migration parser must accept all 12 fictional months");
        assert.equal(parsed.rows.length,12);
        const [batch]=await db.insert(importBatches).values({
          organizationId:spec.org.id,importKind:"payroll_history",sourceSystem:"generic",
          fileName:`synthetic-${year}.csv`,totalRows:12,createdCount:12,createdBy:"Fictional Maker",
        }).returning();
        for(const row of parsed.rows as MigratedPayrollHistory[]){
          assert.equal(row.employeeNo,worker.employeeNo);
          await db.insert(historicalPayrollEntries).values({
            organizationId:spec.org.id,employeeId:worker.id,importBatchId:batch.id,
            sourceSystem:"generic",sourceReference:row.sourceReference,
            periodLabel:row.periodLabel,payDate:row.payDate,
            grossPay:money(row.grossPay),basicSalary:money(row.basicSalary),netPay:money(row.netPay),
            taxWithheld:money(row.taxWithheld),sssEmployee:money(row.sssEmployee),
            philHealthEmployee:money(row.philHealthEmployee),pagIbigEmployee:money(row.pagIbigEmployee),
            thirteenthMonth:money(row.thirteenthMonth),
          });
        }
      }
      const history2025=await db.select().from(historicalPayrollEntries).where(and(
        eq(historicalPayrollEntries.organizationId,spec.org.id),
        eq(historicalPayrollEntries.employeeId,worker.id),
      ));
      const sourceRows=history2025.filter(row=>row.payDate.startsWith("2025-"));
      assert.equal(sourceRows.length,12);
      const basic2025=sourceRows.reduce((v,row)=>v+Number(row.basicSalary),0);
      const paid2025=sourceRows.reduce((v,row)=>v+Number(row.thirteenthMonth),0);
      const [revision]=await db.insert(employeePayRevisions).values({
        organizationId:spec.org.id,employeeId:worker.id,effectiveDate:"2026-09-01",
        previousPayBasis:"monthly",previousRateAmount:"18000.00",
        previousStandardWorkDaysPerMonth:"22.00",previousStandardHoursPerDay:"8.00",
        newPayBasis:"monthly",newRateAmount:"20000.00",
        newStandardWorkDaysPerMonth:"22.00",newStandardHoursPerDay:"8.00",
        reason:"Fictional historical correction",
      }).returning();
      const [original,settlement]=await db.insert(payrollRuns).values([
        {organizationId:spec.org.id,status:"Released",periodLabel:"M5 ORIGINAL 2025",
          periodStart:"2025-12-01",periodEnd:"2025-12-15",payDate:"2025-12-15"},
        {organizationId:spec.org.id,status:"Released",periodLabel:"M5 SETTLED 2026",
          periodStart:"2026-10-01",periodEnd:"2026-10-15",payDate:"2026-10-15"},
      ]).returning();
      await db.insert(payrollEntries).values({
        payrollRunId:original.id,employeeId:worker.id,grossPay:"0.00",deductions:"0.00",
        netPay:"0.00",lineItems:[],
      });
      const [retro]=await db.insert(employeePayRetroAdjustments).values({
        organizationId:spec.org.id,employeeId:worker.id,revisionId:revision.id,
        sourcePayrollRunId:original.id,sourcePeriodLabel:"UNTRUSTED",
        amount:money(spec.retro2025),
      }).returning();
      await db.insert(payrollEntries).values({
        payrollRunId:settlement.id,employeeId:worker.id,
        grossPay:money(2000+spec.retro2025+(spec.id==="FB-HISTORY"?2400:0)),
        deductions:"0.00",netPay:money(2000+spec.retro2025+(spec.id==="FB-HISTORY"?2400:0)),
        lineItems:[
          {code:"BASIC",amount:"2000.00"},
          {code:`RETRO-${retro.id}`,amount:money(spec.retro2025)},
          ...(spec.id==="FB-HISTORY"?[{code:"HOLIDAY_UNWORKED",amount:"2400.00"}]:[]),
        ],
      });
      const periods=await loadFinalPayRetroSourcePeriods({
        organizationId:spec.org.id,employeeId:worker.id,adjustmentIds:[retro.id],
      });
      assert.equal(periods.length,1);
      assert.equal(retroSourceTaxYear(String(periods[0].sourcePeriodStart),String(periods[0].sourcePeriodEnd)),2025);
      const correctedBasic=basic2025+spec.retro2025;
      assert.equal(correctedBasic,spec.expected2025Basic);
      const entitlement2025=Number(money(correctedBasic/12));
      const gap2025=Number(money(entitlement2025-paid2025));
      assert.equal(gap2025,spec.expectedGap);
      const candidate=computeFinalPay({
        releasedBasicYtd:0,historicalBasicYtd:correctedBasic,unpaidBasicSalary:0,
        thirteenthPaidYtd:paid2025,grossCompensationYtd:correctedBasic,
        statutoryContributionsYtd:0,taxWithheldYtd:0,mwe:false,
        leaveMonetizationPay:0,separationPay:0,retirementPay:0,otherBenefits:0,loanDeductions:0,
      });
      assert.equal(candidate.thirteenthDue,Math.max(0,gap2025),"never auto clawback");
      const done=await runYearEndAnnualization(spec.org.id,2026,"Synthetic annualization");
      assert.equal(done.employees,1);
      const [annual]=await db.select().from(yearEndAdjustments).where(and(
        eq(yearEndAdjustments.organizationId,spec.org.id),
        eq(yearEndAdjustments.employeeId,worker.id),
        eq(yearEndAdjustments.taxYear,2026),
      ));
      assert.ok(annual);
      const detail=annual.breakdown as { basicSalaryEarned:number; thirteenthEntitlement:number;thirteenthAlreadyPaid:number;thirteenthStillDue:number };
      assert.equal(detail.basicSalaryEarned,spec.expected2026Basic);
      assert.equal(detail.thirteenthStillDue,spec.expected2026Due);
      assert.equal(detail.thirteenthAlreadyPaid,spec.paid2026);
      // Frozen imported annual source evidence must invalidate checker acceptance if history changes.
      const importedEvidence=history2025.map(row=>({
        id:row.id,grossPay:row.grossPay,basicSalary:row.basicSalary,
        thirteenthMonth:row.thirteenthMonth,taxWithheld:row.taxWithheld,
        sssEmployee:row.sssEmployee,philHealthEmployee:row.philHealthEmployee,
        pagIbigEmployee:row.pagIbigEmployee,payDate:row.payDate,
      }));
      const baseSnapshot:FinalPayFingerprintInputs={
        employee:{status:"Separating",basicRate:worker.basicRate,mwe:false,
          orgUnitId:null,legalEntityId:null,employmentType:worker.employmentType,startDate:worker.startDate},
        payProfile:{id:0,payBasis:"monthly",rateAmount:worker.basicRate,
          standardWorkDaysPerMonth:"22",standardHoursPerDay:"8",updatedAt:null},
        released:[],historical:importedEvidence,loans:[],retroSourcePeriods:periods,
      };
      const frozen=finalPaySourceFingerprint(baseSnapshot);
      const [sep]=await db.insert(separationRecords).values({
        organizationId:spec.org.id,employeeId:worker.id,separationType:"resignation",
        noticeDate:"2026-10-01",lastDay:"2026-10-31",
        preparedByUserId:actors[0].id,
        computationSnapshot:{sourceFingerprint:frozen,historicalYear:2025,
          candidateSignedGap:money(gap2025),humanPolicySignOff:false,
          reviewMode:"synthetic-no-money-db-only"},
        status:"draft",
      }).returning();
      await assert.rejects(
        ()=>db.update(separationRecords).set({status:"approved",approvedByUserId:actors[0].id})
          .where(eq(separationRecords.id,sep.id)),
        (err:unknown)=>((err as {cause?:{code?:string}}).cause?.code==="23514"),
      );
      const [approved]=await db.update(separationRecords).set({
        status:"approved",approvedByUserId:actors[1].id,approvedAt:new Date(),
      }).where(eq(separationRecords.id,sep.id)).returning();
      assert.equal(approved.approvedByUserId,actors[1].id);
      assert.notEqual(approved.preparedByUserId,approved.approvedByUserId);
      assert.equal(approved.releasedByUserId,null,"no release");
      const mutated=structuredClone(baseSnapshot);
      mutated.historical[0].basicSalary=String(Number(mutated.historical[0].basicSalary)+1);
      assert.notDeepEqual(frozen,finalPaySourceFingerprint(mutated),
        "changed imported prior-year pay invalidates frozen checker source evidence");
      await db.update(separationRecords).set({
        status:"draft",approvedByUserId:null,approvedAt:null,
      }).where(eq(separationRecords.id,sep.id));
      const [reset]=await db.select().from(separationRecords).where(eq(separationRecords.id,sep.id));
      assert.equal(reset.approvedByUserId,null);
      assert.equal(reset.status,"draft");
      assert.equal(reset.releasedByUserId,null);
      const releaseEvents=await db.select().from(auditEvents).where(and(
        eq(auditEvents.organizationId,spec.org.id),eq(auditEvents.action,"Final pay released with independently separated approvers"),
      ));
      assert.equal(releaseEvents.length,0);
    }
  }finally{
    for(const org of orgs) await db.delete(organizations).where(eq(organizations.id,org.id));
    for(const actor of actors) await db.delete(users).where(eq(users.id,actor.id));
  }
});
