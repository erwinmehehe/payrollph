import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employeePayProfiles,
  employees,
  historicalPayrollEntries,
  laborInspectionRemediations,
  leavePolicies,
  payrollEntries,
  payrollRuns,
  payslips,
  separationRecords,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { ensureCoreCompatibilitySchema } from "@/lib/core-schema-compat";
import {
  buildLaborInspectionFindings,
  type LaborInspectionFinding,
} from "@/lib/labor-inspection-readiness";

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function buildLaborInspectionReadiness(
  organizationId: number,
  options: { today?: string } = {},
) {
  await ensureCoreCompatibilitySchema();
  const today = options.today ?? manilaToday();
  const taxYear = Number(today.slice(0, 4));
  const startDate = `${taxYear}-01-01`;
  const endDate = today;

  const [
    employeeRows,
    payProfileRows,
    runRows,
    historicalRows,
    remittanceRows,
    remittanceMemberRows,
    separationRows,
    leavePolicyRows,
    remediationRows,
  ] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(employeePayProfiles)
      .where(eq(employeePayProfiles.organizationId, organizationId))
      .orderBy(asc(employeePayProfiles.employeeId)),
    db.select().from(payrollRuns)
      .where(and(
        eq(payrollRuns.organizationId, organizationId),
        gte(payrollRuns.payDate, startDate),
        lte(payrollRuns.payDate, endDate),
      ))
      .orderBy(asc(payrollRuns.payDate), asc(payrollRuns.id)),
    db.select({
      employeeId: historicalPayrollEntries.employeeId,
      payDate: historicalPayrollEntries.payDate,
      basicSalary: historicalPayrollEntries.basicSalary,
      thirteenthMonth: historicalPayrollEntries.thirteenthMonth,
    }).from(historicalPayrollEntries)
      .where(and(
        eq(historicalPayrollEntries.organizationId, organizationId),
        gte(historicalPayrollEntries.payDate, startDate),
        lte(historicalPayrollEntries.payDate, endDate),
      )),
    db.select().from(statutoryRemittanceBatches)
      .where(eq(statutoryRemittanceBatches.organizationId, organizationId))
      .orderBy(asc(statutoryRemittanceBatches.dueDate), asc(statutoryRemittanceBatches.id)),
    db.select().from(statutoryRemittanceMembers)
      .where(eq(statutoryRemittanceMembers.organizationId, organizationId))
      .orderBy(asc(statutoryRemittanceMembers.batchId), asc(statutoryRemittanceMembers.employeeNo)),
    db.select().from(separationRecords)
      .where(eq(separationRecords.organizationId, organizationId))
      .orderBy(asc(separationRecords.lastDay), asc(separationRecords.id)),
    db.select().from(leavePolicies)
      .where(eq(leavePolicies.organizationId, organizationId))
      .orderBy(asc(leavePolicies.leaveType)),
    db.select().from(laborInspectionRemediations)
      .where(eq(laborInspectionRemediations.organizationId, organizationId))
      .orderBy(asc(laborInspectionRemediations.createdAt), asc(laborInspectionRemediations.id)),
  ]);

  const runIds = runRows.map((run) => run.id);
  const entryRows = runIds.length
    ? await db.select().from(payrollEntries)
        .where(inArray(payrollEntries.payrollRunId, runIds))
        .orderBy(asc(payrollEntries.payrollRunId), asc(payrollEntries.employeeId))
    : [];
  const entryIds = entryRows.map((entry) => entry.id);
  const payslipRows = entryIds.length
    ? await db.select({ payrollEntryId: payslips.payrollEntryId })
        .from(payslips)
        .where(and(
          eq(payslips.organizationId, organizationId),
          inArray(payslips.payrollEntryId, entryIds),
        ))
    : [];

  const result = buildLaborInspectionFindings({
    today,
    taxYear,
    startDate,
    endDate,
    employees: employeeRows.map((employee) => ({
      id: employee.id,
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
      title: employee.title,
      status: employee.status,
      startDate: String(employee.startDate),
      region: employee.region,
      mwe: employee.mwe,
      basicRate: Number(employee.basicRate),
      restDay: employee.restDay,
    })),
    payProfiles: payProfileRows.map((profile) => ({
      employeeId: profile.employeeId,
      payBasis: profile.payBasis,
      rateAmount: Number(profile.rateAmount),
      standardWorkDaysPerMonth: Number(profile.standardWorkDaysPerMonth),
      standardHoursPerDay: Number(profile.standardHoursPerDay),
    })),
    runs: runRows.map((run) => ({
      id: run.id,
      periodLabel: run.periodLabel,
      periodStart: String(run.periodStart),
      periodEnd: String(run.periodEnd),
      payDate: String(run.payDate),
      status: run.status,
      employeeCount: run.employeeCount,
    })),
    entries: entryRows.map((entry) => ({
      id: entry.id,
      payrollRunId: entry.payrollRunId,
      employeeId: entry.employeeId,
      grossPay: Number(entry.grossPay),
      deductions: Number(entry.deductions),
      netPay: Number(entry.netPay),
      status: entry.status,
      lineItems: entry.lineItems,
      trace: entry.trace,
    })),
    payslipEntryIds: payslipRows.map((row) => row.payrollEntryId),
    historicalEntries: historicalRows.map((row) => ({
      employeeId: row.employeeId,
      payDate: String(row.payDate),
      basicSalary: row.basicSalary == null ? null : Number(row.basicSalary),
      thirteenthMonth: Number(row.thirteenthMonth),
    })),
    remittanceBatches: remittanceRows.map((batch) => ({
      id: batch.id,
      agency: batch.agency as "SSS" | "PhilHealth" | "Pag-IBIG",
      applicableMonth: batch.applicableMonth,
      dueDate: String(batch.dueDate),
      status: batch.status,
      expectedTotal: Number(batch.expectedTotal),
      amountPaid: batch.amountPaid == null ? null : Number(batch.amountPaid),
    })),
    remittanceMembers: remittanceMemberRows.map((member) => ({
      id: member.id,
      batchId: member.batchId,
      employeeId: member.employeeId,
      employeeNo: member.employeeNo,
      totalContribution: Number(member.totalContribution),
      postingStatus: member.postingStatus,
      exceptionNote: member.exceptionNote,
    })),
    separations: separationRows.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      lastDay: String(row.lastDay),
      finalPayDueDate: row.finalPayDueDate ? String(row.finalPayDueDate) : null,
      status: row.status,
      netFinalPay: Number(row.netFinalPay),
      coeIssued: row.coeIssued,
      releaseReference: row.releaseReference,
    })),
    leavePolicies: leavePolicyRows.map((row) => ({
      leaveType: row.leaveType,
      annualDays: Number(row.annualDays),
      payTreatment: row.payTreatment,
      active: row.active,
    })),
  });

  const remediationByKey = new Map(remediationRows.map((row) => [row.findingKey, row]));
  const activeKeys = new Set(result.findings.map((finding) => finding.key));

  const findings = result.findings.map((finding) => {
    const remediation = remediationByKey.get(finding.key) ?? null;
    return {
      ...finding,
      remediation: remediation
        ? {
            id: remediation.id,
            status: remediation.status === "resolved" ? "reopened" : remediation.status,
            storedStatus: remediation.status,
            owner: remediation.owner,
            acknowledgedBy: remediation.acknowledgedBy,
            acknowledgedAt: remediation.acknowledgedAt,
            resolutionNote: remediation.resolutionNote,
            evidenceReference: remediation.evidenceReference,
            resolvedBy: remediation.resolvedBy,
            resolvedAt: remediation.resolvedAt,
          }
        : null,
    };
  });

  const readyToClose = remediationRows
    .filter((row) => row.status !== "resolved" && !activeKeys.has(row.findingKey))
    .map((row) => ({
      id: row.id,
      findingKey: row.findingKey,
      ruleCode: row.ruleCode,
      owner: row.owner,
      status: row.status,
      acknowledgedBy: row.acknowledgedBy,
      acknowledgedAt: row.acknowledgedAt,
      createdAt: row.createdAt,
    }));

  const closed = remediationRows
    .filter((row) => row.status === "resolved" && !activeKeys.has(row.findingKey))
    .map((row) => ({
      id: row.id,
      findingKey: row.findingKey,
      ruleCode: row.ruleCode,
      owner: row.owner,
      resolutionNote: row.resolutionNote,
      evidenceReference: row.evidenceReference,
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt,
    }));

  return {
    generatedAt: new Date().toISOString(),
    range: { startDate, endDate, label: `Calendar year ${taxYear}` },
    ...result,
    findings,
    remediation: {
      readyToClose,
      closed,
      tracked: remediationRows.length,
    },
  };
}

export function findingByKey(
  findings: Array<LaborInspectionFinding & { remediation?: unknown }>,
  key: string,
) {
  return findings.find((finding) => finding.key === key) ?? null;
}
