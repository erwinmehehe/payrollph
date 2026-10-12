import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalTasks, auditEvents, employeePayProfiles, employees,
  governmentFilingValidations, legalEntities, organizations,
  payoutBatches, payrollEntries, payrollRuns, payslips,
} from "../src/db/schema";
import { calculateEmployeePay } from "../src/lib/payroll-engine";
import { enginePreviewRow, loadFirstPayrollPreview } from "../src/lib/first-payroll-preview";
import { validFirstPayrollPreviewDates } from "../src/lib/first-payroll-preview-contract";
import { FIRST_PAYROLL_OWNER, isFirstPayrollKey, canOpenInlineFirstPayroll } from "../src/lib/first-payroll-ownership";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { statutoryRuleVersionsForDate } from "../src/lib/ph-statutory-rule-packs";
import { nationalHolidayCalendarForDate } from "../src/lib/wage-orders";
import { buildFirstPayrollJourney } from "../src/lib/first-payroll-journey";
import { buildFirstPayrollReadiness } from "../src/lib/first-payroll-readiness";

test("first-payroll flag is default off and enabled by exact true only", () => {
  for(const value of [undefined,"","TRUE","1","false","true "]) {
    assert.equal(criticalReleaseFlagEnabled("firstPayrollInline", { FIRST_PAYROLL_INLINE_UI_ENABLED:value }),false);
  }
  assert.equal(criticalReleaseFlagEnabled("firstPayrollInline", { FIRST_PAYROLL_INLINE_UI_ENABLED:"true" }),true);
});

test("seven governed steps have one role owner and invalid handoff keys are denied", () => {
  const steps = buildFirstPayrollJourney(buildFirstPayrollReadiness({
    workspaceName:"Synthetic Company", employees:[], memberships:[], payrollStatuses:[],
  }));
  assert.deepEqual(steps.map(row=>row.key),Object.keys(FIRST_PAYROLL_OWNER));
  assert.deepEqual(steps.map(row=>FIRST_PAYROLL_OWNER[row.key].role),
    ["owner","hr","hr","owner","payroll","checker","bookkeeper"]);
  for(const unsafe of [null,undefined,"","__proto__","toString","release","time-released",1])
    assert.equal(isFirstPayrollKey(unsafe),false);
});

test("role and feature policy hides new screens for existing tenants, demo and scoped roles", () => {
  for(const role of ["owner","admin","bookkeeper","hr","payroll","checker"]) {
    assert.equal(canOpenInlineFirstPayroll({
      enabled:true,selfServeCustomer:true,companyWide:true,demoRole:false,role,
    }),true,role);
  }
  for(const input of [
    {enabled:false,selfServeCustomer:true,companyWide:true,demoRole:false,role:"owner"},
    {enabled:true,selfServeCustomer:false,companyWide:true,demoRole:false,role:"owner"},
    {enabled:true,selfServeCustomer:true,companyWide:false,demoRole:false,role:"hr"},
    {enabled:true,selfServeCustomer:true,companyWide:true,demoRole:true,role:"owner"},
    {enabled:true,selfServeCustomer:true,companyWide:true,demoRole:false,role:"employee"},
    {enabled:true,selfServeCustomer:true,companyWide:true,demoRole:false,role:"manager"},
  ]) assert.equal(canOpenInlineFirstPayroll(input),false);
});

test("bad dates and unsupported 17-day cutoff are rejected before engine use", () => {
  assert.equal(validFirstPayrollPreviewDates("2026-10-01","2026-10-15","2026-10-15"),true);
  for(const values of [
    ["2026-02-30","2026-03-01","2026-03-02"],
    ["2026-10-16","2026-10-15","2026-10-15"],
    ["2026-10-01","2026-10-17","2026-10-17"],
    ["2026-10-01","2026-10-15","2026-10-14"],
  ]) assert.equal(validFirstPayrollPreviewDates(values[0],values[1],values[2]),false);
});

test("preview delegates actual employee statutory and withholding calculations to unchanged engine", () => {
  const worker = {
    id:1,organizationId:1,firstName:"Synthetic",lastName:"Employee",employeeNo:"T-1",
    tin:"123456789",bankAccount:"synthetic-bank",bankCode:"TEST",restDay:"Sunday",
    status:"Active",startDate:"2026-01-01",basicRate:"28000.00",
    mwe:false,region:"NCR",pagIbigVoluntaryMonthly:"0",
  } as unknown as typeof employees.$inferSelect;
  const payProfile = {
    employeeId:1,organizationId:1,payBasis:"monthly",rateAmount:"28000.00",
    standardWorkDaysPerMonth:"22",standardHoursPerDay:"8",
  } as unknown as typeof employeePayProfiles.$inferSelect;
  const source = {
    employee:worker,punches:[],advisories:[],unitName:"First payroll preview",
    periodLabel:"2026-10-01–2026-10-15",
    payProfile:{ payBasis:payProfile.payBasis,
      rateAmount:Number(payProfile.rateAmount),standardWorkDaysPerMonth:22,
      standardHoursPerDay:8 },
    periodStart:"2026-10-01",periodEnd:"2026-10-15",payDate:"2026-10-15",
    statutoryRuleVersions:statutoryRuleVersionsForDate("2026-10-15"),
    holidayCalendar:nationalHolidayCalendarForDate("2026-10-15"),
    statutoryDeductionTiming:"split",
    isFinalCutoffOfMonth:false,
  };
  const calc = calculateEmployeePay(source);
  const preview = enginePreviewRow({
    employee:worker,payProfile,periodStart:source.periodStart,
    periodEnd:source.periodEnd,payDate:source.payDate,
    statutoryDeductionTiming:"split",
    punchesExist:false,approvedLeaveExists:false,effectivePayChangeExists:false,
    activeLoanExists:false,complexInputsExist:false,unsupportedCalendar:false,
    priorCutoffRequired:false,
  });
  assert.equal(preview.gross,calc.gross.toFixed(2));
  assert.equal(preview.net,calc.net.toFixed(2));
  for(const [column,code] of [
    ["sss","SSS"],["philHealth","PHIC"],["pagIbig","HDMF"],["withholding","WHT"],
  ] as const) {
    assert.equal(preview[column],Math.abs(Number(calc.lineItems.find(line=>line.code===code)?.amount??0)).toFixed(2));
  }
  const blocked = enginePreviewRow({ employee:worker,payProfile,
    periodStart:source.periodStart, periodEnd:source.periodEnd,payDate:source.payDate,
    statutoryDeductionTiming:"split",punchesExist:true,
    approvedLeaveExists:false,effectivePayChangeExists:false,activeLoanExists:false,
    complexInputsExist:false,unsupportedCalendar:false,priorCutoffRequired:false,
  });
  assert.equal(blocked.gross,null);
  assert.equal(blocked.status,"blocked");
  assert.ok(blocked.blockers.some(reason=>reason.includes("Clock punches")));
});

test("read-only preview creates ZERO payroll/approval/bank/filing/audit rows, including repeated previews and foreign-tenant data", async () => {
  const unique = randomUUID().slice(0,12);
  const [alpha,beta] = await db.insert(organizations).values([
    {name:"Preview Alpha "+unique,legalName:"Preview Alpha "+unique},
    {name:"Preview Beta "+unique,legalName:"Preview Beta "+unique},
  ]).returning();
  try {
    const [aEntity,bEntity] = await db.insert(legalEntities).values([
      {organizationId:alpha.id,code:"PRIM",legalName:"Preview Alpha",displayName:"Alpha",primaryEntity:true},
      {organizationId:beta.id,code:"PRIM",legalName:"Preview Beta",displayName:"Beta",primaryEntity:true},
    ]).returning();
    const [first,foreign] = await db.insert(employees).values([
      {
        organizationId:alpha.id,legalEntityId:aEntity.id,employeeNo:"PREVIEW-A-"+unique,
        firstName:"Preview",lastName:"Alpha",avatarInitials:"PA",title:"Staff",
        basicRate:"28000.00",status:"Active",tin:"123456789",
        bankCode:"TEST",bankAccount:"synthetic",restDay:"Sunday",
        startDate:"2026-01-01",region:"NCR",
      },
      {
        organizationId:beta.id,legalEntityId:bEntity.id,employeeNo:"PREVIEW-B-"+unique,
        firstName:"Private",lastName:"Foreign",avatarInitials:"PF",title:"Staff",
        basicRate:"42000.00",status:"Active",tin:"987654321",
        bankCode:"TEST",bankAccount:"synthetic",restDay:"Sunday",
        startDate:"2026-01-01",region:"NCR",
      },
    ]).returning();
    await db.insert(employeePayProfiles).values([
      {organizationId:alpha.id,employeeId:first.id,payBasis:"monthly",
        rateAmount:"28000.00",standardWorkDaysPerMonth:"22",standardHoursPerDay:"8"},
      {organizationId:beta.id,employeeId:foreign.id,payBasis:"monthly",
        rateAmount:"42000.00",standardWorkDaysPerMonth:"22",standardHoursPerDay:"8"},
    ]);
    const capture = async () => Promise.all([
      db.select({n:count()}).from(payrollRuns).then(rows=>rows[0].n),
      db.select({n:count()}).from(payrollEntries).then(rows=>rows[0].n),
      db.select({n:count()}).from(payslips).then(rows=>rows[0].n),
      db.select({n:count()}).from(approvalTasks).then(rows=>rows[0].n),
      db.select({n:count()}).from(payoutBatches).then(rows=>rows[0].n),
      db.select({n:count()}).from(governmentFilingValidations).then(rows=>rows[0].n),
      db.select({n:count()}).from(auditEvents).then(rows=>rows[0].n),
    ]);
    const before = await capture();
    const preview = await loadFirstPayrollPreview({
      organizationId:alpha.id,periodStart:"2026-10-01",periodEnd:"2026-10-15",
      payDate:"2026-10-15",orgUnitId:null,
    });
    const again = await loadFirstPayrollPreview({
      organizationId:alpha.id,periodStart:"2026-10-01",periodEnd:"2026-10-15",
      payDate:"2026-10-15",orgUnitId:null,
    });
    const after=await capture();
    assert.deepEqual(after,before,"preview must not insert or update payroll, approval, payout, filing or audit data");
    assert.deepEqual(again,preview,"repeated same-period preview must be read-only and deterministic");
    assert.equal(preview.readOnly,true);
    assert.equal(preview.rows.length,1);
    assert.equal(preview.rows[0].employeeId,first.id);
    assert.ok(!JSON.stringify(preview).includes("Private Foreign"),"cross-tenant worker must not appear");
    assert.ok(!JSON.stringify(preview).includes(String(foreign.employeeNo)),"foreign employee number must not appear");
  } finally {
    // Avoid modifying user data: only the two synthetic tenant FK cascades.
    await db.delete(organizations).where(eq(organizations.id,alpha.id));
    await db.delete(organizations).where(eq(organizations.id,beta.id));
  }
});
