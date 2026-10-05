import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  doleComplianceSubmissions,
  doleReportingProfiles,
  employees,
  historicalPayrollEntries,
  organizations,
  payrollEntries,
  payrollRuns,
  separationRecords,
} from "@/db/schema";
import { ensureDoleReportingSchema } from "@/lib/dole-reporting-schema";
import { buildDoleThirteenthMonthReport } from "@/lib/dole-thirteenth-month-report";
import { readBasicAndThirteenth } from "@/lib/final-pay";

export async function buildDoleThirteenthMonthState(
  organizationId: number,
  taxYear: number,
) {
  await ensureDoleReportingSchema();

  const [organization, profileRows, staff, runs, historical, separations, submissions] = await Promise.all([
    db.select().from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select().from(doleReportingProfiles)
      .where(eq(doleReportingProfiles.organizationId, organizationId))
      .limit(1),
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.employeeNo)),
    db.select().from(payrollRuns)
      .where(and(
        eq(payrollRuns.organizationId, organizationId),
        eq(payrollRuns.status, "Released"),
        sql`extract(year from ${payrollRuns.payDate}) = ${taxYear}`,
      ))
      .orderBy(asc(payrollRuns.payDate), asc(payrollRuns.id)),
    db.select().from(historicalPayrollEntries)
      .where(and(
        eq(historicalPayrollEntries.organizationId, organizationId),
        sql`extract(year from ${historicalPayrollEntries.payDate}) = ${taxYear}`,
      ))
      .orderBy(asc(historicalPayrollEntries.payDate), asc(historicalPayrollEntries.id)),
    db.select().from(separationRecords)
      .where(and(
        eq(separationRecords.organizationId, organizationId),
        eq(separationRecords.status, "released"),
        sql`extract(year from ${separationRecords.lastDay}) = ${taxYear}`,
      ))
      .orderBy(asc(separationRecords.lastDay), asc(separationRecords.id)),
    db.select().from(doleComplianceSubmissions)
      .where(and(
        eq(doleComplianceSubmissions.organizationId, organizationId),
        eq(doleComplianceSubmissions.reportType, "13th_month_pay"),
        eq(doleComplianceSubmissions.reportYear, taxYear),
      ))
      .orderBy(desc(doleComplianceSubmissions.submittedAt), desc(doleComplianceSubmissions.id)),
  ]);

  if (!organization) return null;

  const runIds = runs.map((run) => run.id);
  const entries = runIds.length
    ? await db.select().from(payrollEntries)
        .where(inArray(payrollEntries.payrollRunId, runIds))
        .orderBy(asc(payrollEntries.employeeId), asc(payrollEntries.id))
    : [];

  const employeeById = new Map(staff.map((employee) => [employee.id, employee]));
  const buckets = new Map<number, {
    basicSalaryEarned: number;
    payrollThirteenthPaid: number;
    historicalThirteenthPaid: number;
    finalPayThirteenthPaid: number;
    basicSalaryComplete: boolean;
  }>();

  function bucket(employeeId: number) {
    const value = buckets.get(employeeId) ?? {
      basicSalaryEarned: 0,
      payrollThirteenthPaid: 0,
      historicalThirteenthPaid: 0,
      finalPayThirteenthPaid: 0,
      basicSalaryComplete: true,
    };
    buckets.set(employeeId, value);
    return value;
  }

  for (const entry of entries) {
    const parsed = readBasicAndThirteenth(entry.lineItems);
    const item = bucket(entry.employeeId);
    item.basicSalaryEarned += parsed.basic;
    item.payrollThirteenthPaid += parsed.thirteenthPaid;
  }

  for (const row of historical) {
    const item = bucket(row.employeeId);
    if (row.basicSalary == null) item.basicSalaryComplete = false;
    else item.basicSalaryEarned += Number(row.basicSalary);
    item.historicalThirteenthPaid += Number(row.thirteenthMonth);
  }

  for (const row of separations) {
    const item = bucket(row.employeeId);
    item.finalPayThirteenthPaid += Number(row.prorated13thMonth);
    item.basicSalaryEarned = Math.max(item.basicSalaryEarned, Number(row.basicSalaryEarnedYtd));
    const snapshot = row.computationSnapshot && typeof row.computationSnapshot === "object"
      ? row.computationSnapshot as Record<string, unknown>
      : {};
    if (snapshot.legacyHistoryMissingBasic === true) item.basicSalaryComplete = false;
  }

  const workers = [...buckets.entries()].flatMap(([employeeId, totals]) => {
    const employee = employeeById.get(employeeId);
    if (!employee) return [];
    return [{
      employeeId,
      employeeNo: employee.employeeNo,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      ...totals,
    }];
  });

  const profile = profileRows[0] ?? null;
  const built = buildDoleThirteenthMonthReport({
    taxYear,
    establishmentName: organization.legalName || organization.name,
    profile: profile
      ? {
          establishmentAddress: profile.establishmentAddress,
          principalBusiness: profile.principalBusiness,
          contactName: profile.contactName,
          contactPosition: profile.contactPosition,
          contactPhone: profile.contactPhone,
        }
      : null,
    workers,
  });

  const currentSubmission = submissions.find((row) =>
    row.status === "submitted" && row.reportHash === built.reportHash,
  ) ?? null;
  const latestSubmission = submissions[0] ?? null;

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      legalName: organization.legalName,
    },
    profile,
    ...built,
    submissionCurrent: Boolean(currentSubmission),
    currentSubmission,
    latestSubmission,
    submissionHistory: submissions,
  };
}
