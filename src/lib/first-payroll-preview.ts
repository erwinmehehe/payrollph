import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests, benefitEnrollments, calamityAdvisories, deMinimisGrants,
  earnedWageRequests, employeeCompensationComponents, employeeRestDayRevisions,
  employeeScheduleAssignments, employeeWorksiteAssignments, expenseClaims, leaveConversions,
  overtimeRequests, scheduleOverrides, yearEndAdjustments,
  employeeLoans, employeeMweClassifications, employeePayProfiles, employeePayRevisions,
  employees, firstPayrollJourneyProgress, historicalPayrollEntries, holidays, legalEntities,
  leaveRequests, organizations, payPolicies, payrollRuns, supplementaryEarnings,
  timePunches, userOrganizations, employeePayRetroAdjustments,
} from "@/db/schema";
import { decryptGovernmentId } from "./government-id-crypto";
import { isCanonicalPhSemiMonthlyPeriod } from "./payroll-calendar";
import { statutoryRuleVersionsForDate } from "./ph-statutory-rule-packs";

/** A query-only reader is required. Unlike the payroll worker, this function has no
 * mutation capability and never bootstraps a run, employer, audit or payroll entry.
 * This is readiness/source discovery ONLY. Monetary results come exclusively
 * from the canonical worker assembler in first-payroll-canonical-preview.ts. */
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

 // Discover period-specific sources without pricing or assuming their approval.
 // The canonical worker assembler alone resolves completed sources into amounts.
 const employeeIds=people.map(employee=>employee.id);
 const scopedChecks=[
  ["time punches",()=>reader.select({employeeId:timePunches.employeeId}).from(timePunches).where(and(
    eq(timePunches.organizationId,organizationId),inArray(timePunches.employeeId,employeeIds),
    gte(timePunches.workDate,periodStart),lte(timePunches.workDate,periodEnd),
  )).groupBy(timePunches.employeeId)],
  ["employee pay revisions",()=>reader.select({employeeId:employeePayRevisions.employeeId}).from(employeePayRevisions).where(and(
    eq(employeePayRevisions.organizationId,organizationId),inArray(employeePayRevisions.employeeId,employeeIds),
    lte(employeePayRevisions.effectiveDate,periodEnd),
  )).groupBy(employeePayRevisions.employeeId)],
  ["supplementary earnings",()=>reader.select({employeeId:supplementaryEarnings.employeeId}).from(supplementaryEarnings).where(and(
    eq(supplementaryEarnings.organizationId,organizationId),inArray(supplementaryEarnings.employeeId,employeeIds),
    lte(supplementaryEarnings.effectiveDate,periodEnd),
  )).groupBy(supplementaryEarnings.employeeId)],
  ["leave requests",()=>reader.select({employeeId:leaveRequests.employeeId}).from(leaveRequests).where(and(
    eq(leaveRequests.organizationId,organizationId),inArray(leaveRequests.employeeId,employeeIds),
    lte(leaveRequests.startDate,periodEnd),
  )).groupBy(leaveRequests.employeeId)],
  ["de minimis grants",()=>reader.select({employeeId:deMinimisGrants.employeeId}).from(deMinimisGrants).where(and(
    eq(deMinimisGrants.organizationId,organizationId),inArray(deMinimisGrants.employeeId,employeeIds),
    lte(deMinimisGrants.effectiveOn,periodEnd),
    or(isNull(deMinimisGrants.endedOn),gte(deMinimisGrants.endedOn,periodStart)),
  )).groupBy(deMinimisGrants.employeeId)],
  ["wage advances",()=>reader.select({employeeId:earnedWageRequests.employeeId}).from(earnedWageRequests).where(and(
    eq(earnedWageRequests.organizationId,organizationId),inArray(earnedWageRequests.employeeId,employeeIds),
  )).groupBy(earnedWageRequests.employeeId)],
  ["employee loans",()=>reader.select({employeeId:employeeLoans.employeeId}).from(employeeLoans).where(and(
    eq(employeeLoans.organizationId,organizationId),inArray(employeeLoans.employeeId,employeeIds),
  )).groupBy(employeeLoans.employeeId)],
  ["historical payroll entries",()=>reader.select({employeeId:historicalPayrollEntries.employeeId}).from(historicalPayrollEntries).where(and(
    eq(historicalPayrollEntries.organizationId,organizationId),inArray(historicalPayrollEntries.employeeId,employeeIds),
    lte(historicalPayrollEntries.payDate,payDate),
  )).groupBy(historicalPayrollEntries.employeeId)],
  ["MWE classification history",()=>reader.select({employeeId:employeeMweClassifications.employeeId}).from(employeeMweClassifications).where(and(
    eq(employeeMweClassifications.organizationId,organizationId),inArray(employeeMweClassifications.employeeId,employeeIds),
    lte(employeeMweClassifications.effectiveFrom,payDate),
  )).groupBy(employeeMweClassifications.employeeId)],
  ["benefit enrollment",()=>reader.select({employeeId:benefitEnrollments.employeeId}).from(benefitEnrollments).where(and(
    eq(benefitEnrollments.organizationId,organizationId),inArray(benefitEnrollments.employeeId,employeeIds),
    lte(benefitEnrollments.startedOn,periodEnd),
    or(isNull(benefitEnrollments.endedOn),gte(benefitEnrollments.endedOn,periodStart)),
  )).groupBy(benefitEnrollments.employeeId)],
  ["recurring compensation",()=>reader.select({employeeId:employeeCompensationComponents.employeeId}).from(employeeCompensationComponents).where(and(
    eq(employeeCompensationComponents.organizationId,organizationId),
    inArray(employeeCompensationComponents.employeeId,employeeIds),
    lte(employeeCompensationComponents.effectiveFrom,periodEnd),
    or(isNull(employeeCompensationComponents.effectiveUntil),gte(employeeCompensationComponents.effectiveUntil,periodStart)),
  )).groupBy(employeeCompensationComponents.employeeId)],
  ["retroactive adjustments",()=>reader.select({employeeId:employeePayRetroAdjustments.employeeId}).from(employeePayRetroAdjustments).where(and(
    eq(employeePayRetroAdjustments.organizationId,organizationId),
    inArray(employeePayRetroAdjustments.employeeId,employeeIds),
  )).groupBy(employeePayRetroAdjustments.employeeId)],
  ["expense claims",()=>reader.select({employeeId:expenseClaims.employeeId}).from(expenseClaims).where(and(
    eq(expenseClaims.organizationId,organizationId),inArray(expenseClaims.employeeId,employeeIds),
  )).groupBy(expenseClaims.employeeId)],
  ["leave conversions",()=>reader.select({employeeId:leaveConversions.employeeId}).from(leaveConversions).where(and(
    eq(leaveConversions.organizationId,organizationId),inArray(leaveConversions.employeeId,employeeIds),
  )).groupBy(leaveConversions.employeeId)],
  ["overtime approvals",()=>reader.select({employeeId:overtimeRequests.employeeId}).from(overtimeRequests).where(and(
    eq(overtimeRequests.organizationId,organizationId),inArray(overtimeRequests.employeeId,employeeIds),
    gte(overtimeRequests.workDate,periodStart),lte(overtimeRequests.workDate,periodEnd),
  )).groupBy(overtimeRequests.employeeId)],
  ["rest-day revisions",()=>reader.select({employeeId:employeeRestDayRevisions.employeeId}).from(employeeRestDayRevisions).where(and(
    eq(employeeRestDayRevisions.organizationId,organizationId),inArray(employeeRestDayRevisions.employeeId,employeeIds),
    lte(employeeRestDayRevisions.effectiveDate,periodEnd),
  )).groupBy(employeeRestDayRevisions.employeeId)],
  ["workforce schedule assignments",()=>reader.select({employeeId:employeeScheduleAssignments.employeeId}).from(employeeScheduleAssignments).where(and(
    eq(employeeScheduleAssignments.organizationId,organizationId),inArray(employeeScheduleAssignments.employeeId,employeeIds),
    lte(employeeScheduleAssignments.effectiveFrom,periodEnd),
    or(isNull(employeeScheduleAssignments.effectiveUntil),gte(employeeScheduleAssignments.effectiveUntil,periodStart)),
  )).groupBy(employeeScheduleAssignments.employeeId)],
  ["workforce schedule overrides",()=>reader.select({employeeId:scheduleOverrides.employeeId}).from(scheduleOverrides).where(and(
    eq(scheduleOverrides.organizationId,organizationId),inArray(scheduleOverrides.employeeId,employeeIds),
    gte(scheduleOverrides.workDate,periodStart),lte(scheduleOverrides.workDate,periodEnd),
  )).groupBy(scheduleOverrides.employeeId)],
  ["worksite assignment history",()=>reader.select({employeeId:employeeWorksiteAssignments.employeeId}).from(employeeWorksiteAssignments).where(and(
    eq(employeeWorksiteAssignments.organizationId,organizationId),
    inArray(employeeWorksiteAssignments.employeeId,employeeIds),
    lte(employeeWorksiteAssignments.effectiveFrom,periodEnd),
    or(isNull(employeeWorksiteAssignments.effectiveUntil),gte(employeeWorksiteAssignments.effectiveUntil,periodStart)),
  )).groupBy(employeeWorksiteAssignments.employeeId)],
  ["year-end tax adjustments",()=>reader.select({employeeId:yearEndAdjustments.employeeId}).from(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId,organizationId),inArray(yearEndAdjustments.employeeId,employeeIds),
    eq(yearEndAdjustments.taxYear,Number(payDate.slice(0,4))),
  )).groupBy(yearEndAdjustments.employeeId)],
  ["attendance corrections",()=>reader.select({employeeId:attendanceCorrectionRequests.employeeId}).from(attendanceCorrectionRequests).where(and(
    eq(attendanceCorrectionRequests.organizationId,organizationId),
    inArray(attendanceCorrectionRequests.employeeId,employeeIds),
    gte(attendanceCorrectionRequests.workDate,periodStart),
    lte(attendanceCorrectionRequests.workDate,periodEnd),
  )).groupBy(attendanceCorrectionRequests.employeeId)],
 ] as const;
 const workerBlockers=new Map<number,string[]>();
 // groupBy fetches only distinct employee IDs, never monetary or personal rows.
 if(employeeIds.length>0){
  const matches=await Promise.all(scopedChecks.map(async ([name,load])=>({
    name,ids:(await load()).map(row=>row.employeeId),
  })));
  for(const match of matches){
   for(const id of match.ids){
    if(!employeeIds.includes(id))throw Error("Preview source returned an out-of-scope employee.");
    workerBlockers.set(id,[
      ...(workerBlockers.get(id)??[]),
      "Full payroll-context reconciliation required: "+match.name+" is recorded for this employee.",
    ]);
   }
  }
 }
 // Policies, local holiday calendars, calamity advisories and prior runs can
 // affect more than one employee and remain organization-wide fail-closed gates.
 const globalChecks=[
  ["custom pay policies",()=>reader.select({id:payPolicies.id}).from(payPolicies).where(eq(payPolicies.organizationId,organizationId)).limit(1)],
  ["employer-specific holidays",()=>reader.select({id:holidays.id}).from(holidays).where(and(
    eq(holidays.organizationId,organizationId),lte(holidays.holidayDate,periodEnd),
  )).limit(1)],
  ["previous payroll runs",()=>reader.select({id:payrollRuns.id}).from(payrollRuns).where(eq(payrollRuns.organizationId,organizationId)).limit(1)],
  ["calamity advisories",()=>reader.select({id:calamityAdvisories.id}).from(calamityAdvisories).where(and(
    eq(calamityAdvisories.organizationId,organizationId),eq(calamityAdvisories.active,true),
    lte(calamityAdvisories.startDate,periodEnd),gte(calamityAdvisories.endDate,periodStart),
  )).limit(1)],
 ] as const;
 const globalObserved=await Promise.all(globalChecks.map(async ([name,load])=>({
  name,present:(await load()).length>0,
 })));
 for(const source of globalObserved){
  if(source.present)blockers.push("Full payroll-context reconciliation required: "+source.name+" is recorded.");
 }
 const asOf=statutoryRuleVersionsForDate(payDate);
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
   if(legal&&employee.legalEntityId!==legal.id)problems.push("Employee belongs to another legal employer.");
   const profile=byEmployee.get(employee.id);
   if(!profile)problems.push("Missing employee pay profile");
   let gross:number|null=null,sss:number|null=null,philHealth:number|null=null,
       pagIbig:number|null=null,withholding:number|null=null,net:number|null=null;
   problems.push(...(workerBlockers.get(employee.id)??[]));
   return {employeeId:employee.id,employeeNo:employee.employeeNo,name:employee.firstName+" "+employee.lastName,
    gross,sss,philHealth,pagIbig,withholding,net,blockers:problems};
 });
 const allBlockers=[...blockers];
 if(rows.some(row=>row.blockers.length))allBlockers.push("Resolve employee-level blockers before treating preview as ready.");
 const warnings=[
  "First-payroll preview is provisional, read-only and not a payslip, approval, ledger entry or payment instruction.",
  "A ready preview does not replace per-period timesheet, attendance-lock, statutory, assurance or independent release checks.",
  "Source discovery never calculates net pay. Only the canonical read-only payroll projection may supply amounts.",
 ];
 return {dryRun:true as const,persisted:false as const,previewReady:false,
   rows,blockers:allBlockers,warnings,statutoryRuleVersions:asOf};
}
