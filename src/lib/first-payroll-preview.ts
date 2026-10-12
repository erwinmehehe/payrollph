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
  reader.select().from(firstPayrollJourneyProgress).where(eq(firstPayrollJourneyProgress.organizationId,organizationId)).limit(1),
  reader.select({role:userOrganizations.role}).from(userOrganizations).where(and(eq(userOrganizations.organizationId,organizationId),eq(userOrganizations.active,true))),
 ]);
 const legal=legalRows.find(e=>e.primaryEntity)??null;
 const recorded=progressRows[0]?.completedSteps??{};
 const blockers:string[]=[];
 if(!legal)blockers.push("Missing active primary legal employer.");
 if(!recorded.company)blockers.push("Pay schedule has not been confirmed by an employer administrator.");
 if(legal?.payrollCalendarMode==="ph_semi_monthly"&&!isCanonicalPhSemiMonthlyPeriod(periodStart,periodEnd))
  blockers.push("Selected period does not match the employer's semi-monthly pay schedule.");
 if(!legal?.payrollCalendarMode)blockers.push("No pay schedule configured.");
 const review=recorded.time;
 if(!review||review.periodStart!==periodStart||review.periodEnd!==periodEnd)
  blockers.push("An authorized HR reviewer must review attendance for this exact pay period.");
 if(!memberRows.some(r=>r.role==="payroll"))blockers.push("No active Payroll Officer role is assigned.");
 if(!memberRows.some(r=>r.role==="checker"))blockers.push("No active independent Checker role is assigned.");
 if(!people.length)blockers.push("No active employees in the selected period.");

 // Any unmodeled inputs force a blocker rather than a falsely precise payslip.
 // The normal payroll engine handles all these sources; this first-run preview
 // intentionally supports only a genuinely simple initial fixed-salary cutoff.
 const sources=[
  ["time punches",timePunches],["employee pay revisions",employeePayRevisions],
  ["supplementary earnings",supplementaryEarnings],["leave requests",leaveRequests],
  ["de minimis grants",deMinimisGrants],["wage advances",earnedWageRequests],
  ["employee loans",employeeLoans],["custom pay policies",payPolicies],
  ["employer-specific holidays",holidays],["historical payroll entries",historicalPayrollEntries],
  ["MWE classification history",employeeMweClassifications],
  ["benefit enrollment",benefitEnrollments],
  ["recurring compensation",employeeCompensationComponents],
  ["retroactive adjustments",employeePayRetroAdjustments],
  ["previous payroll runs",payrollRuns],
 ] as const;
 // All queries are tenant-filtered. A row in an optional source is a blocker,
 // even if it might not affect this period; omission is safer than undercounting.
 for(const [name,table] of sources){
  const present=await reader.select({id:table.id}).from(table).where(eq(table.organizationId,organizationId)).limit(1);
  if(present.length)blockers.push("Full payroll-context reconciliation required: "+name+" is recorded.");
 }
 const asOf=statutoryRuleVersionsForDate(payDate);
 const holidayCalendar=nationalHolidayCalendarForDate(periodEnd);
 const byEmployee=new Map(profiles.map(p=>[p.employeeId,p]));
 const rows=people.map(employee=>{
   const problems:string[]=[];
   if(!employee.tin)problems.push("Missing TIN");
   if(!employee.bankAccount||!employee.bankCode)problems.push("Missing bank payout destination");
   if(legal&&employee.legalEntityId!==legal.id)problems.push("Employee belongs to another legal employer.");
   if(employee.mwe)problems.push("MWE treatment requires an individually reviewed wage classification.");
   const profile=byEmployee.get(employee.id);
   if(!profile)problems.push("Missing employee pay profile");
   if(profile&&profile.payBasis!=="monthly")problems.push("Daily/hourly payroll requires approved worked-time inputs.");
   let gross:number|null=null,sss:number|null=null,philHealth:number|null=null,
       pagIbig:number|null=null,withholding:number|null=null,net:number|null=null;
   if(profile&&profile.payBasis==="monthly"&&legal){
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
       if(calc.status==="Exception")problems.push("Payroll engine calculation requires human exception review.");
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
