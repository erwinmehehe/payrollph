import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  compensationCycles,
  compensationProposals,
  employees,
  jobApplicants,
  jobRequisitions,
  orgUnits,
  payrollRuns,
  positionAssignments,
  positions,
  separationRecords,
  workerEmploymentEvents,
} from "@/db/schema";
import {
  hcmAnalyticsDate,
  hcmManilaDay,
  summarizeHcmPeopleIntelligence,
  type PeopleIntelligenceSummary,
} from "@/lib/hcm-people-intelligence";

export function philippinePeopleAnalyticsDate(now = new Date()) {
  return hcmManilaDay(now);
}

function field(value: number | null, digits = 0): string {
  return value == null ? "Not verifiable" : value.toFixed(digits);
}

function pesos(value: number | null): string {
  return value == null ? "Not verifiable" : value.toFixed(2);
}

function reportRows(summary: PeopleIntelligenceSummary): string[][] {
  const { asOf, windowStart, historical } = summary;
  const interval = `${windowStart} to ${asOf}`;
  return [
    ["Coverage", "Reporting date", asOf, "Philippine business date; no future snapshot"],
    ["Coverage", "Historical status verification", `${summary.coverage.percent.toFixed(1)}%`,
      `${summary.coverage.verified}/${summary.coverage.eligible} eligible worker records with a supported current or applied effective-date status`],
    ["People", "Verified headcount", field(summary.headcount),
      "Workers employed on the reporting date, excluding released separations; withheld when historical source status is unknown"],
    ["People", "Hires in window", field(summary.hires), `Employee employment start dates from ${interval}`],
    ["People", "Completed exits in window", field(summary.completedExits),
      `Only final-pay separation records with status released and last day in ${interval}`],
    ["People", "Released-exit turnover", summary.turnoverRate == null ? "Not verifiable" : `${summary.turnoverRate.toFixed(1)}%`,
      "Completed exits divided by average verified headcount at start/end; not a predictive attrition score"],
    ["Staffing", "Primary assigned FTE", field(summary.assignedFte, 2),
      "Effective-dated primary position assignments for verified employed workers; not scheduled hours"],
    ["Positions", "Approved vacant positions", field(summary.vacantPositions),
      historical ? "Historical position statuses are not effective-dated; this metric is unavailable for past dates"
        : "Current approved/open positions without an active incumbent; excludes unapproved positions"],
    ["Positions", "Recorded annual vacancy budget", pesos(summary.recordedAnnualVacancyBudget),
      "Current approved vacant position budgets in PHP, not a payroll forecast or obligated spend"],
    ["Recruitment", "Open requisitions", field(summary.activeRequisitions),
      historical ? "Historical requisition statuses cannot be reconstructed" : "Current open/interviewing requisition records"],
    ["Recruitment", "Median days to hire", field(summary.medianHireDays, 1),
      `Recorded applicant hire timestamp minus requisition creation date for hires in ${interval}`],
    ["Compensation", "Active cycle review budget", pesos(summary.activeCycleBudget),
      "Current budget pools of active compensation cycles only; PHP; not released payroll"],
    ["Compensation", "Approved annual salary movement", pesos(summary.approvedCompensationDeltaAnnual),
      "Approved/scheduled/applied proposals in current active cycles, proposed minus prior annual salary; not a cash payout"],
    ["Payroll", "Released gross payroll", pesos(summary.releasedPayrollGross),
      `Gross PHP from released payroll runs with pay dates in ${interval}; excludes drafts`],
    ["Payroll", "Released net payroll", pesos(summary.releasedPayrollNet),
      `Net PHP from the same ${summary.releasedRunCount} released run(s); no employee pay detail`],
    ...(summary.units?.map((unit) => [
      "Organization", unit.orgUnit, String(unit.headcount),
      "Current employed headcount; small cells are suppressed without revealing an inferable residual",
    ]) ?? []),
    ...summary.warnings.map((message) => ["Data quality", "Review required", "Attention", message]),
  ];
}

export async function buildHcmPeopleIntelligenceReport(input: {
  organizationId: number;
  asOf?: string;
  windowDays?: number;
  now?: Date;
}) {
  const today = philippinePeopleAnalyticsDate(input.now);
  const asOf = hcmAnalyticsDate(input.asOf ?? today, today);
  const windowDays = input.windowDays ?? 90;
  if (![30, 90, 180, 365].includes(windowDays)) {
    throw new Error("windowDays must be one of 30, 90, 180 or 365.");
  }
  const [staff, events, positionRows, assignmentRows, requisitions, candidates, separations,
    payroll, cycles, proposals, units] = await Promise.all([
    db.select({
      id: employees.id,
      startDate: employees.startDate,
      status: employees.status,
      orgUnitId: employees.orgUnitId,
      employmentType: employees.employmentType,
    }).from(employees).where(eq(employees.organizationId, input.organizationId)),
    db.select({
      id: workerEmploymentEvents.id,
      employeeId: workerEmploymentEvents.employeeId,
      effectiveDate: workerEmploymentEvents.effectiveDate,
      eventType: workerEmploymentEvents.eventType,
      fromStatus: workerEmploymentEvents.fromStatus,
      toStatus: workerEmploymentEvents.toStatus,
      fromOrgUnitId: workerEmploymentEvents.fromOrgUnitId,
      toOrgUnitId: workerEmploymentEvents.toOrgUnitId,
    }).from(workerEmploymentEvents).where(eq(workerEmploymentEvents.organizationId, input.organizationId)),
    db.select({
      id: positions.id,
      status: positions.status,
      orgUnitId: positions.orgUnitId,
      annualBudget: positions.annualBudget,
    }).from(positions).where(eq(positions.organizationId, input.organizationId)),
    db.select({
      employeeId: positionAssignments.employeeId,
      positionId: positionAssignments.positionId,
      fte: positionAssignments.fte,
      assignmentType: positionAssignments.assignmentType,
      effectiveFrom: positionAssignments.effectiveFrom,
      effectiveUntil: positionAssignments.effectiveUntil,
    }).from(positionAssignments).where(eq(positionAssignments.organizationId, input.organizationId)),
    db.select({
      id: jobRequisitions.id,
      positionId: jobRequisitions.positionId,
      status: jobRequisitions.status,
      createdAt: jobRequisitions.createdAt,
    }).from(jobRequisitions).where(eq(jobRequisitions.organizationId, input.organizationId)),
    db.select({
      requisitionId: jobApplicants.requisitionId,
      hiredAt: jobApplicants.hiredAt,
    }).from(jobApplicants).where(eq(jobApplicants.organizationId, input.organizationId)),
    db.select({
      employeeId: separationRecords.employeeId,
      status: separationRecords.status,
      lastDay: separationRecords.lastDay,
    }).from(separationRecords).where(eq(separationRecords.organizationId, input.organizationId)),
    db.select({
      status: payrollRuns.status,
      payDate: payrollRuns.payDate,
      grossPay: payrollRuns.grossPay,
      netPay: payrollRuns.netPay,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, input.organizationId),
      lte(payrollRuns.payDate, asOf),
    )),
    db.select({
      id: compensationCycles.id,
      status: compensationCycles.status,
      budgetPool: compensationCycles.budgetPool,
    }).from(compensationCycles).where(eq(compensationCycles.organizationId, input.organizationId)),
    db.select({
      cycleId: compensationProposals.cycleId,
      status: compensationProposals.status,
      currentAnnual: compensationProposals.currentAnnual,
      proposedAnnual: compensationProposals.proposedAnnual,
    }).from(compensationProposals).where(eq(compensationProposals.organizationId, input.organizationId)),
    db.select({
      id: orgUnits.id,
      name: orgUnits.name,
    }).from(orgUnits).where(eq(orgUnits.organizationId, input.organizationId)),
  ]);

  const normalized = summarizeHcmPeopleIntelligence({
    asOf, today, windowDays,
    workers: staff.map((row) => ({ ...row, startDate: String(row.startDate) })),
    events: events.map((row) => ({ ...row, effectiveDate: String(row.effectiveDate) })),
    positions: positionRows,
    assignments: assignmentRows.map((row) => ({
      ...row,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil == null ? null : String(row.effectiveUntil),
    })),
    requisitions: requisitions.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    applicants: candidates.map((row) => ({ ...row, hiredAt: row.hiredAt?.toISOString() ?? null })),
    separations: separations.map((row) => ({ ...row, lastDay: String(row.lastDay) })),
    payrollRuns: payroll.map((row) => ({ ...row, payDate: String(row.payDate) })),
    cycles, proposals, units,
  });

  return {
    key: "people" as const,
    columns: ["Area", "Metric", "Value", "Evidence / definition"],
    rows: reportRows(normalized),
    peopleIntelligence: normalized,
  };
}
