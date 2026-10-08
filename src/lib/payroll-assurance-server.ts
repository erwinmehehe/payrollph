import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employeeMweClassifications, employees, payrollEntries, payrollRuns } from "@/db/schema";
import { evaluatePayrollAssurance } from "@/lib/payroll-assurance";
import { isBelowMinimum } from "@/lib/wage-orders";
import { resolveMweClassification, type MweClassificationRecord } from "@/lib/mwe-classification";

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
  const mweRows = employeeIds.length
    ? await db.select().from(employeeMweClassifications).where(and(
        eq(employeeMweClassifications.organizationId, run.organizationId),
        inArray(employeeMweClassifications.employeeId, employeeIds),
        eq(employeeMweClassifications.status, "approved"),
        lte(employeeMweClassifications.effectiveFrom, String(run.payDate)),
        or(
          isNull(employeeMweClassifications.effectiveUntil),
          gte(employeeMweClassifications.effectiveUntil, String(run.payDate)),
        ),
      ))
    : [];
  const mweByEmployee = new Map<number, MweClassificationRecord[]>();
  for (const row of mweRows) {
    mweByEmployee.set(row.employeeId, [
      ...(mweByEmployee.get(row.employeeId) ?? []),
      {
        id: row.id,
        employeeId: row.employeeId,
        isMwe: row.isMwe,
        region: row.region,
        employeeDailyWage: row.employeeDailyWage,
        statutoryMinimumWage: row.statutoryMinimumWage,
        wageOrderReference: row.wageOrderReference,
        evidenceReference: row.evidenceReference,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        status: row.status,
      },
    ]);
  }
  const mweGovernanceFindings: Array<{ employeeId: number; employeeNo: string; detail: string }> = [];

  const employeeContext = staff.map((employee) => {
    let taxMwe = employee.mwe;
    try {
      const resolution = resolveMweClassification(
        mweByEmployee.get(employee.id) ?? [],
        String(run.payDate),
        employee.mwe,
      );
      taxMwe = resolution.isMwe;
      if (resolution.governanceMissing) {
        mweGovernanceFindings.push({
          employeeId: employee.id,
          employeeNo: employee.employeeNo,
          detail: "Legacy MWE=true is being used without an approved effective-dated classification containing wage-order and evidence references.",
        });
      }
    } catch (error) {
      taxMwe = false;
      mweGovernanceFindings.push({
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        detail: error instanceof Error ? error.message : "MWE classification history is ambiguous.",
      });
    }
    let minimumWageIssue = false;
    try {
      minimumWageIssue = isBelowMinimum(
        Number(employee.basicRate),
        employee.region ?? "NCR",
      ).below && !taxMwe;
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

  for (const finding of mweGovernanceFindings) {
    assurance.findings.unshift({
      code: "MWE_CLASSIFICATION_GOVERNANCE",
      severity: "high",
      blocking: true,
      title: `MWE classification evidence required for ${finding.employeeNo}`,
      detail: finding.detail,
      employeeId: finding.employeeId,
    });
    assurance.summary.high += 1;
    assurance.summary.blocking += 1;
  }

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
