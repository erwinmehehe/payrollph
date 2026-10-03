import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns } from "@/db/schema";
import { evaluatePayrollAssurance } from "@/lib/payroll-assurance";
import { isBelowMinimum } from "@/lib/wage-orders";

export async function buildPayrollAssurance(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return null;

  const currentEntries = await db
    .select()
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, run.id))
    .orderBy(asc(payrollEntries.id));

  const priorRuns = await db
    .select()
    .from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, run.organizationId),
      eq(payrollRuns.status, "Released"),
      lt(payrollRuns.payDate, run.payDate),
    ))
    .orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id))
    .limit(24);
  const previousRun = priorRuns.find(
    (candidate) => candidate.scopeOrgUnitId === run.scopeOrgUnitId,
  ) ?? null;

  const previousEntries = previousRun
    ? await db
        .select()
        .from(payrollEntries)
        .where(eq(payrollEntries.payrollRunId, previousRun.id))
        .orderBy(asc(payrollEntries.id))
    : [];

  const employeeIds = [...new Set(currentEntries.map((entry) => entry.employeeId))];
  const staff = employeeIds.length
    ? await db
        .select()
        .from(employees)
        .where(and(
          eq(employees.organizationId, run.organizationId),
          inArray(employees.id, employeeIds),
        ))
    : [];

  const employeeContext = staff.map((employee) => {
    let minimumWageIssue = false;
    try {
      minimumWageIssue = isBelowMinimum(
        Number(employee.basicRate),
        employee.region ?? "NCR",
      ).below && !employee.mwe;
    } catch {
      // An unmapped region is a configuration issue, not proof that the
      // employee is below a wage floor. The compliance preflight reports it.
      minimumWageIssue = false;
    }

    return {
      id: employee.id,
      employeeNo: employee.employeeNo,
      status: employee.status,
      startDate: employee.startDate,
      basicRate: employee.basicRate,
      region: employee.region,
      bankAccount: employee.bankAccount,
      bankCode: employee.bankCode,
      minimumWageIssue,
    };
  });

  const assurance = evaluatePayrollAssurance(currentEntries, previousEntries, {
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    payDate: run.payDate,
    employees: employeeContext,
  });

  const expectedEntries = Number(run.employeeCount ?? 0);
  const totalChunks = Number(run.totalChunks ?? 0);
  const processedChunks = Number(run.processedChunks ?? 0);
  const incompleteCoverage =
    expectedEntries <= 0
    || currentEntries.length !== expectedEntries
    || totalChunks <= 0
    || processedChunks < totalChunks;

  if (incompleteCoverage) {
    assurance.findings.unshift({
      code: "INCOMPLETE_PAYROLL_RUN",
      severity: "high",
      blocking: true,
      title: "Payroll calculation is incomplete",
      detail: `Stored coverage is ${currentEntries.length}/${expectedEntries} employee entries and ${processedChunks}/${totalChunks} processing chunks. Complete or recalculate the run before checker approval.`,
    });
    assurance.summary.high += 1;
    assurance.summary.blocking += 1;
  }

  return {
    run,
    previousRun: previousRun ?? null,
    assurance,
  };
}
