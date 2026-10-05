import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employeePayProfiles, employeeScheduleAssignments, employees, leavePolicies, organizations, payrollRuns, schedulePatternDays, schedulePatterns } from "@/db/schema";
import { buildCompliancePolicyReview } from "@/lib/compliance-policy-review";

function monthsAgoIso(today: string, months: number) {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 - months, day));
  return date.toISOString().slice(0, 10);
}

export async function buildCompliancePolicyReviewForOrganization(organizationId: number, today: string) {
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) throw new Error("Organization not found.");
  const reviewStart = monthsAgoIso(today, 6);
  const [employeeRows, profileRows, policyRows, assignmentRows, patternRows, patternDayRows, runRows] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, organizationId)).orderBy(asc(employees.id)),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, organizationId)).orderBy(asc(employeePayProfiles.employeeId)),
    db.select().from(leavePolicies).where(eq(leavePolicies.organizationId, organizationId)).orderBy(asc(leavePolicies.leaveType)),
    db.select().from(employeeScheduleAssignments).where(eq(employeeScheduleAssignments.organizationId, organizationId)).orderBy(asc(employeeScheduleAssignments.employeeId), asc(employeeScheduleAssignments.effectiveFrom)),
    db.select().from(schedulePatterns).where(eq(schedulePatterns.organizationId, organizationId)).orderBy(asc(schedulePatterns.code)),
    db.select({ patternId: schedulePatternDays.patternId, dayIndex: schedulePatternDays.dayIndex, isRestDay: schedulePatternDays.isRestDay })
      .from(schedulePatternDays).innerJoin(schedulePatterns, eq(schedulePatternDays.patternId, schedulePatterns.id))
      .where(eq(schedulePatterns.organizationId, organizationId)).orderBy(asc(schedulePatternDays.patternId), asc(schedulePatternDays.dayIndex)),
    db.select().from(payrollRuns).where(and(eq(payrollRuns.organizationId, organizationId), eq(payrollRuns.status, "Released"), gte(payrollRuns.payDate, reviewStart), lte(payrollRuns.payDate, today)))
      .orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id)),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    reviewWindow: { startDate: reviewStart, endDate: today },
    ...buildCompliancePolicyReview({
      payrollCalendarMode: organization.payrollCalendarMode,
      releasedRuns: runRows.map((run) => ({ id: run.id, periodLabel: run.periodLabel, periodStart: String(run.periodStart), periodEnd: String(run.periodEnd), payDate: String(run.payDate) })),
      employees: employeeRows.map((employee) => ({ id: employee.id, employeeNo: employee.employeeNo, name: employee.firstName + " " + employee.lastName, status: employee.status, startDate: String(employee.startDate), restDay: employee.restDay })),
      payProfiles: profileRows.map((profile) => ({ employeeId: profile.employeeId, payBasis: profile.payBasis, standardHoursPerDay: Number(profile.standardHoursPerDay) })),
      leavePolicies: policyRows.map((policy) => ({ leaveType: policy.leaveType, annualDays: Number(policy.annualDays), payTreatment: policy.payTreatment, paidPercentage: Number(policy.paidPercentage), active: policy.active })),
      scheduleAssignments: assignmentRows.map((row) => ({ employeeId: row.employeeId, patternId: row.patternId, effectiveFrom: String(row.effectiveFrom), effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null })),
      patterns: patternRows.map((row) => ({ id: row.id, code: row.code, name: row.name, cycleDays: row.cycleDays, active: row.active })),
      patternDays: patternDayRows,
      today,
    }),
  };
}