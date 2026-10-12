import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  benefitEnrollments, calamityAdvisories, deMinimisGrants, earnedWageRequests,
  employeeCompensationComponents, employeeLoans, employeePayProfiles,
  employeePayRevisions, employeePayRetroAdjustments, employeeScheduleAssignments,
  employees, expenseClaims, holidays, legalEntities, leaveConversions, leaveRequests,
  organizations, overtimeRequests, payPolicies, payrollRuns, scheduleOverrides,
  supplementaryEarnings, timePunches, yearEndAdjustments,
} from "@/db/schema";
import { calculateEmployeePay, PAYROLL_RULE_VERSION } from "@/lib/payroll-engine";
import { nationalHolidayCalendarForDate } from "@/lib/wage-orders";
import { statutoryRuleVersionsForDate } from "@/lib/ph-statutory-rule-packs";
import { isCanonicalPhSemiMonthlyPeriod } from "@/lib/payroll-calendar";
import { findPayrollPeriodConflict } from "@/lib/payroll-period-integrity";

/**
 * This module contains ONLY SELECTs and invokes the existing synchronous,
 * side-effect-free employee calculator. No enqueue/ensure, draft creation,
 * payroll entry, payslip, ledger, payout, approval, filing, or audit writes.
 *
 * The initial certified preview is intentionally narrow: where input
 * dependencies cannot be assembled exactly as in payroll-engine.ts, the
 * employee is BLOCKED and monetary columns remain null, never guessed.
 */
import {
  type FirstPayrollPreview, type FirstPayrollPreviewRow,
  validFirstPayrollPreviewDates,
} from "@/lib/first-payroll-preview-contract";

const currency = (amount: number) => Number(amount).toFixed(2);
const lastDayOfMonth = (ymd: string) => {
  const date = new Date(ymd + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.getUTCDate() === 1;
};

export function enginePreviewRow(input: {
  employee: typeof employees.$inferSelect;
  payProfile?: typeof employeePayProfiles.$inferSelect | null;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  statutoryDeductionTiming: string;
  punchesExist: boolean;
  approvedLeaveExists: boolean;
  effectivePayChangeExists: boolean;
  activeLoanExists: boolean;
  complexInputsExist: boolean;
  unsupportedCalendar: boolean;
  priorCutoffRequired: boolean;
}): FirstPayrollPreviewRow {
  const { employee: e } = input;
  const blockers: string[] = [];
  if (!e.tin?.trim()) blockers.push("Missing employee TIN — complete employee statutory identifiers.");
  if (!((e.bankAccount?.trim() && e.bankCode?.trim()) || e.mobile?.trim()))
    blockers.push("Missing bank account or mobile-wallet payout details.");
  if (!e.restDay) blockers.push("Rest-day schedule is not assigned.");
  if (!input.payProfile) blockers.push("Missing pay basis/profile.");
  if (input.payProfile && input.payProfile.payBasis !== "monthly")
    blockers.push("Daily/hourly pay needs verified worked time; use the normal payroll run for an accurate calculation.");
  if (input.punchesExist) blockers.push("Clock punches exist; schedule and attendance adjustments require the full payroll calculation.");
  if (input.approvedLeaveExists) blockers.push("Approved leave needs authoritative leave-pay attribution.");
  if (input.effectivePayChangeExists) blockers.push("Effective-dated pay change needs the full pay timeline.");
  if (input.activeLoanExists) blockers.push("Active loan repayments need the approved loan ledger.");
  if (input.complexInputsExist) blockers.push("Additional compensation, benefits or advanced payroll inputs need a full production-input preview.");
  if (input.unsupportedCalendar) blockers.push("The selected dates do not match the legal employer's configured payroll calendar.");
  if (input.priorCutoffRequired) blockers.push("Month-final statutory true-up requires earlier released cutoff evidence.");

  let monetary: Pick<FirstPayrollPreviewRow, "gross" | "sss" | "philHealth" | "pagIbig" | "withholding" | "net"> =
    { gross: null, sss: null, philHealth: null, pagIbig: null, withholding: null, net: null };
  const pricingIncomplete = !input.payProfile || input.payProfile.payBasis !== "monthly" ||
    input.punchesExist || input.approvedLeaveExists || input.effectivePayChangeExists ||
    input.activeLoanExists || input.complexInputsExist || input.unsupportedCalendar || input.priorCutoffRequired;
  if (!pricingIncomplete && input.payProfile) {
    try {
      const calc = calculateEmployeePay({
        employee: e,
        punches: [],
        advisories: [],
        unitName: "First payroll preview",
        periodLabel: input.periodStart + "–" + input.periodEnd,
        payProfile: {
          payBasis: input.payProfile.payBasis,
          rateAmount: Number(input.payProfile.rateAmount),
          standardWorkDaysPerMonth: Number(input.payProfile.standardWorkDaysPerMonth),
          standardHoursPerDay: Number(input.payProfile.standardHoursPerDay),
        },
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        payDate: input.payDate,
        statutoryRuleVersions: statutoryRuleVersionsForDate(input.payDate),
        holidayCalendar: nationalHolidayCalendarForDate(input.periodEnd),
        statutoryDeductionTiming: input.statutoryDeductionTiming,
        isFinalCutoffOfMonth: lastDayOfMonth(input.periodEnd),
      });
      const deduction = (code: string) =>
        currency(Math.abs(Number(calc.lineItems.find(item => item.code === code)?.amount ?? 0)));
      monetary = {
        gross: currency(calc.gross), sss: deduction("SSS"),
        philHealth: deduction("PHIC"), pagIbig: deduction("HDMF"),
        withholding: deduction("WHT"), net: currency(calc.net),
      };
      if (calc.status === "Exception") {
        blockers.push("Payroll engine returned an exception — review authoritative payroll inputs.");
        // Never expose worker statutory IDs, payment details or engine trace in a preview.
      }
    } catch {
      blockers.push("Payroll engine could not calculate this employee with the available verified inputs.");
    }
  }
  return {
    employeeId: e.id,
    employeeNo: e.employeeNo,
    employeeName: e.firstName + " " + e.lastName,
    ...monetary,
    status: blockers.length ? "blocked" : "ready",
    blockers,
  };
}

export async function loadFirstPayrollPreview(input: {
  organizationId: number;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  orgUnitId: number | null;
}): Promise<FirstPayrollPreview> {
  const { organizationId, periodStart, periodEnd, payDate, orgUnitId } = input;
  if (!validFirstPayrollPreviewDates(periodStart,periodEnd,payDate))
    throw new Error("Period must have valid dates, at most 16 days, with pay date after period end.");
  const ruleVersions = statutoryRuleVersionsForDate(payDate);
  const nationalHolidays = nationalHolidayCalendarForDate(periodEnd);
  if (!ruleVersions) throw new Error("Unsupported statutory pay date.");

  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id,organizationId)).limit(1);
  if (!organization) throw new Error("Employer not available.");
  const [legalEntity] = await db.select().from(legalEntities).where(and(
    eq(legalEntities.organizationId,organizationId), eq(legalEntities.primaryEntity,true),
    eq(legalEntities.active,true),
  )).limit(1);
  const blockers: string[] = [];
  if (!legalEntity) blockers.push("No active primary legal employer configured.");
  // Do not estimate holiday eligibility, shift or hazard premiums from
  // synthetic empty attendance when the authoritative payroll assembler has
  // period-specific entitlements to reconcile.
  const [localHolidayRows, calamityRows] = await Promise.all([
    db.select({id:holidays.id}).from(holidays).where(and(
      or(isNull(holidays.organizationId),eq(holidays.organizationId,organizationId)),
      gte(holidays.holidayDate,periodStart),lte(holidays.holidayDate,periodEnd),
    )).limit(1),
    db.select({id:calamityAdvisories.id}).from(calamityAdvisories).where(and(
      eq(calamityAdvisories.organizationId,organizationId),eq(calamityAdvisories.active,true),
      lte(calamityAdvisories.startDate,periodEnd),gte(calamityAdvisories.endDate,periodStart),
    )).limit(1),
  ]);
  const nationalHolidayInCutoff = nationalHolidays.some(item=>item.date>=periodStart && item.date<=periodEnd);
  const exceptionalCalendar = nationalHolidayInCutoff || localHolidayRows.length>0 || calamityRows.length>0;
  if (exceptionalCalendar)
    blockers.push("Holiday or calamity treatment requires the official attendance and policy calculation; preview pay amounts are withheld.");
  const legalEntityId = legalEntity?.id;
  const calendarMode = legalEntity?.payrollCalendarMode ?? organization.payrollCalendarMode;
  const unsupportedCalendar = calendarMode === "ph_semi_monthly" &&
    !isCanonicalPhSemiMonthlyPeriod(periodStart,periodEnd);
  if (unsupportedCalendar) blockers.push("Period does not match legal employer's semi-monthly calendar.");
  const conflicting = legalEntityId ? await findPayrollPeriodConflict({
    organizationId, legalEntityId, scopeOrgUnitId: orgUnitId, periodStart, periodEnd,
  }) : null;
  if (conflicting) blockers.push("Payroll period overlaps an existing run; review run #" + conflicting.id + ".");
  const employeeRows = legalEntityId ? await db.select().from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.legalEntityId, legalEntityId),
    eq(employees.status,"Active"),
    lte(employees.startDate,periodEnd),
    orgUnitId === null ? undefined : eq(employees.orgUnitId,orgUnitId),
  )).limit(501) : [];
  if (employeeRows.length > 500) throw new Error("Preview limited to 500 employees per scope. Select a smaller authorized unit.");
  if (!employeeRows.length) blockers.push("No active employees in the selected payroll scope.");
  const ids = employeeRows.map(e=>e.id);
  const [
    profiles, punches, leave, payChanges, loans, existingRuns, complicated, activePolicies, specialSchedules,
  ] = ids.length ? await Promise.all([
    db.select().from(employeePayProfiles).where(and(eq(employeePayProfiles.organizationId,organizationId),inArray(employeePayProfiles.employeeId,ids))),
    db.select({employeeId:timePunches.employeeId}).from(timePunches).where(and(eq(timePunches.organizationId,organizationId),
      inArray(timePunches.employeeId,ids),gte(timePunches.workDate,periodStart),lte(timePunches.workDate,periodEnd))),
    db.select({employeeId:leaveRequests.employeeId}).from(leaveRequests).where(and(eq(leaveRequests.organizationId,organizationId),
      inArray(leaveRequests.employeeId,ids),eq(leaveRequests.status,"Approved"),
      lte(leaveRequests.startDate,periodEnd),gte(leaveRequests.endDate,periodStart))),
    db.select({employeeId:employeePayRevisions.employeeId}).from(employeePayRevisions).where(and(eq(employeePayRevisions.organizationId,organizationId),
      inArray(employeePayRevisions.employeeId,ids),lte(employeePayRevisions.effectiveDate,periodEnd))),
    db.select({employeeId:employeeLoans.employeeId}).from(employeeLoans).where(and(eq(employeeLoans.organizationId,organizationId),
      inArray(employeeLoans.employeeId,ids),inArray(employeeLoans.status,["active","approved"]))),
    db.select({ id:payrollRuns.id, status:payrollRuns.status, periodStart:payrollRuns.periodStart,
      periodEnd:payrollRuns.periodEnd }).from(payrollRuns).where(and(eq(payrollRuns.organizationId,organizationId),
      legalEntityId ? eq(payrollRuns.legalEntityId,legalEntityId) : undefined)),
    Promise.all([
      db.select({employeeId:benefitEnrollments.employeeId}).from(benefitEnrollments).where(and(eq(benefitEnrollments.organizationId,organizationId),inArray(benefitEnrollments.employeeId,ids))),
      db.select({employeeId:deMinimisGrants.employeeId}).from(deMinimisGrants).where(and(eq(deMinimisGrants.organizationId,organizationId),inArray(deMinimisGrants.employeeId,ids))),
      db.select({employeeId:earnedWageRequests.employeeId}).from(earnedWageRequests).where(and(eq(earnedWageRequests.organizationId,organizationId),inArray(earnedWageRequests.employeeId,ids))),
      db.select({employeeId:employeeCompensationComponents.employeeId}).from(employeeCompensationComponents).where(and(eq(employeeCompensationComponents.organizationId,organizationId),inArray(employeeCompensationComponents.employeeId,ids))),
      db.select({employeeId:employeePayRetroAdjustments.employeeId}).from(employeePayRetroAdjustments).where(and(eq(employeePayRetroAdjustments.organizationId,organizationId),inArray(employeePayRetroAdjustments.employeeId,ids))),
      db.select({employeeId:expenseClaims.employeeId}).from(expenseClaims).where(and(eq(expenseClaims.organizationId,organizationId),inArray(expenseClaims.employeeId,ids))),
      db.select({employeeId:leaveConversions.employeeId}).from(leaveConversions).where(and(eq(leaveConversions.organizationId,organizationId),inArray(leaveConversions.employeeId,ids))),
      db.select({employeeId:overtimeRequests.employeeId}).from(overtimeRequests).where(and(eq(overtimeRequests.organizationId,organizationId),inArray(overtimeRequests.employeeId,ids))),
      db.select({employeeId:supplementaryEarnings.employeeId}).from(supplementaryEarnings).where(and(eq(supplementaryEarnings.organizationId,organizationId),inArray(supplementaryEarnings.employeeId,ids))),
      db.select({employeeId:yearEndAdjustments.employeeId}).from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId,organizationId),inArray(yearEndAdjustments.employeeId,ids))),
    ]).then(groups=>new Set(groups.flat().map(item=>item.employeeId))),
    db.select({id:payPolicies.id}).from(payPolicies).where(and(
      eq(payPolicies.organizationId,organizationId),eq(payPolicies.active,true),
      lte(payPolicies.effectiveFrom,periodEnd),
    )).limit(1),
    Promise.all([
      db.select({employeeId:employeeScheduleAssignments.employeeId}).from(employeeScheduleAssignments).where(and(
        eq(employeeScheduleAssignments.organizationId,organizationId),
        inArray(employeeScheduleAssignments.employeeId,ids),
        lte(employeeScheduleAssignments.effectiveFrom,periodEnd),
        or(isNull(employeeScheduleAssignments.effectiveUntil),gte(employeeScheduleAssignments.effectiveUntil,periodStart)),
      )),
      db.select({employeeId:scheduleOverrides.employeeId}).from(scheduleOverrides).where(and(
        eq(scheduleOverrides.organizationId,organizationId),
        inArray(scheduleOverrides.employeeId,ids),
        gte(scheduleOverrides.workDate,periodStart),lte(scheduleOverrides.workDate,periodEnd),
      )),
    ]).then(groups=>new Set(groups.flat().map(item=>item.employeeId))),
  ]) : [[],[],[],[],[],[],new Set<number>(),[],new Set<number>()];
  // Deliberately refuse to project advanced earning adjustments from a
  // partial input model. Later extension should extract the production input
  // assembler shared with processPayrollChunk.
  const complexInputsExist = activePolicies.length > 0;
  const isMonthFinal = lastDayOfMonth(periodEnd);
  const priorCutoffRequired = isMonthFinal && Number(periodStart.slice(8,10)) >= 16 &&
    !existingRuns.some(run=>run.status==="Released" &&
      String(run.periodStart).slice(0,7)===periodStart.slice(0,7) && String(run.periodEnd) < periodStart);
  const profileById = new Map(profiles.map(profile => [profile.employeeId,profile]));
  const has = (values:Array<{employeeId:number}>,id:number) => values.some(x=>x.employeeId===id);
  const rows = employeeRows.map(employee=>enginePreviewRow({
    employee, payProfile:profileById.get(employee.id),
    periodStart,periodEnd,payDate,
    statutoryDeductionTiming: legalEntity?.statutoryDeductionTiming ?? organization.statutoryDeductionTiming,
    punchesExist:has(punches,employee.id),
    approvedLeaveExists:has(leave,employee.id),
    effectivePayChangeExists:has(payChanges,employee.id),
    activeLoanExists:has(loans,employee.id),
    complexInputsExist: complexInputsExist || complicated.has(employee.id) || specialSchedules.has(employee.id) || exceptionalCalendar, unsupportedCalendar, priorCutoffRequired,
  }));
  if (rows.some(r=>r.blockers.length)) blockers.push("One or more employees have unresolved payroll blockers.");
  const previewReady = blockers.length===0 && rows.length>0 && rows.every(r=>r.status==="ready");
  const sum = (key:"gross"|"sss"|"philHealth"|"pagIbig"|"withholding"|"net") =>
    currency(rows.reduce((n,r)=>n+Number(r[key]??0),0));
  return {
    organizationId,periodStart,periodEnd,payDate,ruleVersion:PAYROLL_RULE_VERSION,
    readOnly:true, previewReady, rows, blockers,
    totals:rows.every(r=>r.gross!==null) ? {
      gross:sum("gross"),sss:sum("sss"),philHealth:sum("philHealth"),pagIbig:sum("pagIbig"),
      withholding:sum("withholding"),net:sum("net"),
    }:null,
    limitations:[
      "Read-only first-payroll estimate. It never creates runs, approvals, ledger entries, payslips or payouts.",
      "Advanced allowances, premiums, prior cutoff true-ups, overtime, leave and payroll policy adjustments are not simulated here.",
      "An authorized human must approve attendance; final payroll must be recalculated and independently checked.",
    ],
  };
}
