import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  benefitEnrollments, deMinimisGrants, earnedWageRequests, employeeCompensationComponents,
  employeeLoans, employeeMweClassifications, employeePayProfiles, employeePayRevisions,
  employees, firstPayrollJourneyProgress, historicalPayrollEntries, holidays, legalEntities,
  leaveRequests, organizations, payPolicies, payrollRuns, supplementaryEarnings,
  timePunches, userOrganizations, employeePayRetroAdjustments,
} from "@/db/schema";
import { calculateEmployeePay } from "./payroll-engine";
import { decryptGovernmentId } from "./government-id-crypto";
import { isCanonicalPhSemiMonthlyPeriod } from "./payroll-calendar";
import { statutoryRuleVersionsForDate } from "./ph-statutory-rule-packs";
import { nationalHolidayCalendarForDate } from "./wage-orders";

/** A query-only reader is required. Unlike the payroll worker, this function has no
 * mutation capability and never bootstraps a run, employer, audit or payroll entry. */
export async function loadReadOnlyFirstPayrollPreview(
  input:{organizationId:number;periodStart:string;periodEnd:string;payDate:string},
  reader:Pick<typeof db,"select">=db,
) {
 const {organizationId,periodStart,periodEnd,payDate}=input;
 const [company]=await reader.select().from(organizations).where(eq(organizations.id,organizationId)).limit(1);
 if(!company)throw Error("Employer not found.");
 const [legalRows,people,profiles,progressRows,memberRows]=await Promise.all([
  reader.select().from(legalEntities).where(and(eq(legalEntities.organizationId,organizationId),eq(legalEntities.active,true))),
  reader.select().from(employees).where(and(eq(employees.organizationId,organizationId),eq(employees.status,"Active"),lte(employees.startDate,periodEnd))),
  reader.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId,organizationId)),
  reader.select().from(firstPayrollJourneyProgress).where(eq(firstPayrollJourneyProgress.organizationId,organizationId)),
  reader.select({role:userOrganizations.role}).from(userOrganizations).where(and(eq(userOrganizations.organizationId,organizationId),eq(userOrganizations.active,true))),
 ]);
 // Refuse multi-employer reads until a separate employer-scoped authorization path is approved.
 if(legalRows.length>1 || (legalRows.length===1 &&
     people.some(employee=>employee.legalEntityId!=null && employee.legalEntityId!==legalRows[0].id)))
   throw Error("MULTI_ENTITY_PREVIEW_REQUIRES_SCOPED_AUTHORIZATION");
 const legal=legalRows.find(e=>e.primaryEntity)??null;
 const companyConfirmed=progressRows.some(row=>row.step==="company" && Boolean(row.data?.completedAt));
 const timeReview=progressRows.find(row=>row.step==="time")?.data;
 const blockers:string[]=[];
 if(!legal)blockers.push("Missing active primary legal employer.");
 if(!companyConfirmed)blockers.push("Pay schedule has not been confirmed by an employer administrator.");
 if(legal?.payrollCalendarMode==="ph_semi_monthly"&&!isCanonicalPhSemiMonthlyPeriod(periodStart,periodEnd))
  blockers.push("Selected period does not match the employer's semi-monthly pay schedule.");
 if(!legal?.payrollCalendarMode)blockers.push("No pay schedule configured.");
 if(!timeReview?.completedAt||timeReview.periodStart!==periodStart||timeReview.periodEnd!==periodEnd)
  blockers.push("An authorized HR reviewer must review attendance for this exact pay period.");
 if(!memberRows.some(r=>r.role==="payroll"))blockers.push("No active Payroll Officer role is assigned.");
 if(!memberRows.some(r=>r.role==="checker"))blockers.push("No active independent Checker role is assigned.");
 if(!people.length)blockers.push("No active employees in the selected period.");

 // Any unmodeled inputs force a blocker rather than a falsely precise payslip.
 // The normal payroll engine handles all these sources; this first-run preview
 // intentionally supports only a genuinely simple initial fixed-salary cutoff.
 const sourceChecks = [
  ["time punches", () => reader.select({id:timePunches.id}).from(timePunches).where(eq(timePunches.organizationId,organizationId)).limit(1)],
  ["employee pay revisions", () => reader.select({id:employeePayRevisions.id}).from(employeePayRevisions).where(eq(employeePayRevisions.organizationId,organizationId)).limit(1)],
  ["supplementary earnings", () => reader.select({id:supplementaryEarnings.id}).from(supplementaryEarnings).where(eq(supplementaryEarnings.organizationId,organizationId)).limit(1)],
  ["leave requests", () => reader.select({id:leaveRequests.id}).from(leaveRequests).where(eq(leaveRequests.organizationId,organizationId)).limit(1)],
  ["de minimis grants", () => reader.select({id:deMinimisGrants.id}).from(deMinimisGrants).where(eq(deMinimisGrants.organizationId,organizationId)).limit(1)],
  ["wage advances", () => reader.select({id:earnedWageRequests.id}).from(earnedWageRequests).where(eq(earnedWageRequests.organizationId,organizationId)).limit(1)],
  ["employee loans", () => reader.select({id:employeeLoans.id}).from(employeeLoans).where(eq(employeeLoans.organizationId,organizationId)).limit(1)],
  ["custom pay policies", () => reader.select({id:payPolicies.id}).from(payPolicies).where(eq(payPolicies.organizationId,organizationId)).limit(1)],
  ["employer-specific holidays", () => reader.select({id:holidays.id}).from(holidays).where(eq(holidays.organizationId,organizationId)).limit(1)],
  ["historical payroll entries", () => reader.select({id:historicalPayrollEntries.id}).from(historicalPayrollEntries).where(eq(historicalPayrollEntries.organizationId,organizationId)).limit(1)],
  ["MWE classification history", () => reader.select({id:employeeMweClassifications.id}).from(employeeMweClassifications).where(eq(employeeMweClassifications.organizationId,organizationId)).limit(1)],
  ["benefit enrollment", () => reader.select({id:benefitEnrollments.id}).from(benefitEnrollments).where(eq(benefitEnrollments.organizationId,organizationId)).limit(1)],
  ["recurring compensation", () => reader.select({id:employeeCompensationComponents.id}).from(employeeCompensationComponents).where(eq(employeeCompensationComponents.organizationId,organizationId)).limit(1)],
  ["retroactive adjustments", () => reader.select({id:employeePayRetroAdjustments.id}).from(employeePayRetroAdjustments).where(eq(employeePayRetroAdjustments.organizationId,organizationId)).limit(1)],
  ["previous payroll runs", () => reader.select({id:payrollRuns.id}).from(payrollRuns).where(eq(payrollRuns.organizationId,organizationId)).limit(1)],
 ] as const;
 // Each closure is a concrete Drizzle table read, never a union-table mutation.
 const observed = await Promise.all(sourceChecks.map(async ([name,load])=>({name,present:(await load()).length>0})));
 for(const check of observed){
   if(check.present)blockers.push("Full payroll-context reconciliation required: "+check.name+" is recorded.");
 }
 const hasUnreconciledContext=observed.some(check=>check.present);
 const asOf=statutoryRuleVersionsForDate(payDate);
 const holidayCalendar=nationalHolidayCalendarForDate(periodEnd);
 const byEmployee=new Map(profiles.map(p=>[p.employeeId,p]));
 const rows=people.map(employee=>{
   const problems:string[]=[];
   if(!employee.tin)problems.push("Missing TIN");
   else {
     try {
       const raw=decryptGovernmentId(employee.tin);
       if(!raw||!/^\d{9}$/.test(raw.replace(/-/g,"")))problems.push("Invalid TIN format");
     } catch { problems.push("TIN encryption cannot be verified with configured keys"); }
   }
   if(!employee.bankAccount||!employee.bankCode)problems.push("Missing bank payout destination");
   if(legal&&employee.legalEntityId!==legal.id)problems.push("Employee belongs to another legal employer.");
   if(employee.mwe)problems.push("MWE treatment requires an individually reviewed wage classification.");
   const profile=byEmployee.get(employee.id);
   if(!profile)problems.push("Missing employee pay profile");
   if(profile&&profile.payBasis!=="monthly")problems.push("Daily/hourly payroll requires approved worked-time inputs.");
   let gross:number|null=null,sss:number|null=null,philHealth:number|null=null,
       pagIbig:number|null=null,withholding:number|null=null,net:number|null=null;
   if(hasUnreconciledContext)problems.push("Calculated amounts withheld until all recorded payroll inputs are reconciled.");
   if(!hasUnreconciledContext&&blockers.length===0&&problems.length===0&&profile&&profile.payBasis==="monthly"&&legal){
     try{
       const calc=calculateEmployeePay({
         employee,punches:[],advisories:[],unitName:"Unassigned",
         periodLabel:periodStart+" - "+periodEnd,
         payProfile:{
          payBasis:profile.payBasis,rateAmount:profile.rateAmount,
          standardWorkDaysPerMonth:profile.standardWorkDaysPerMonth,
          standardHoursPerDay:profile.standardHoursPerDay,
         },
         statutoryDeductionTiming:legal.statutoryDeductionTiming,
         periodStart,periodEnd,payDate,statutoryRuleVersions:asOf,
         holidayCalendar,
       });
       const deduction=(code:string)=>Math.abs(Number(calc.lineItems.find(line=>line.code===code)?.amount??0));
       gross=calc.gross;sss=deduction("SSS");philHealth=deduction("PHIC");
       pagIbig=deduction("HDMF");withholding=deduction("WHT");net=calc.net;
       if(calc.status==="Exception"){
         problems.push("Payroll engine calculation requires human exception review.");
         gross=null;sss=null;philHealth=null;pagIbig=null;withholding=null;net=null;
       }
     }catch{problems.push("Payroll calculator cannot safely resolve these employee inputs.");}
   }
   return {employeeId:employee.id,employeeNo:employee.employeeNo,name:employee.firstName+" "+employee.lastName,
    gross,sss,philHealth,pagIbig,withholding,net,blockers:problems};
 });
 const allBlockers=[...blockers];
 if(rows.some(row=>row.blockers.length))allBlockers.push("Resolve employee-level blockers before treating preview as ready.");
 const warnings=[
  "First-payroll preview is provisional, read-only and not a payslip, approval, ledger entry or payment instruction.",
  "A ready preview does not replace per-period timesheet, attendance-lock, statutory, assurance or independent release checks.",
 ];
 return {dryRun:true as const,persisted:false as const,previewReady:allBlockers.length===0,
   rows,blockers:allBlockers,warnings,statutoryRuleVersions:asOf};
}
