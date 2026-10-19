import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { employees, separationRecords } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import type { EffectivePayRevisionInput, EmployeePayProfileInput } from "@/lib/pay-basis";

/** The current profile may already contain a raise beyond the cutoff/exit. */
export function profileBeforeFutureRevision(current: EmployeePayProfileInput, revisions: EffectivePayRevisionInput[], date: string): EmployeePayProfileInput {
  const next = [...revisions].filter(row => row.effectiveDate > date)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))[0];
  return next ? { payBasis: next.previousPayBasis, rateAmount: next.previousRateAmount,
    standardWorkDaysPerMonth: next.previousStandardWorkDaysPerMonth,
    standardHoursPerDay: next.previousStandardHoursPerDay } : current;
}

/** Include pending exits explicitly: missing approval must block, never omit pay silently. */
export function payrollEmploymentStatus(periodStart: string) {
  if (!criticalReleaseFlagEnabled("approvedExitPayroll")) return eq(employees.status, "Active");
  return or(eq(employees.status, "Active"), and(eq(employees.status, "Separating"), or(
    sql`exists (select 1 from ${separationRecords} where ${separationRecords.organizationId} = ${employees.organizationId} and ${separationRecords.employeeId} = ${employees.id} and ${separationRecords.lastDay} >= ${periodStart})`,
    sql`not exists (select 1 from ${separationRecords} where ${separationRecords.organizationId} = ${employees.organizationId} and ${separationRecords.employeeId} = ${employees.id})`,
  )));
}

/** Used by the HTTP preflight and by the worker's own transaction-bound reader. */
export async function loadApprovedPayrollExits(reader: Pick<typeof db, "select">, organizationId: number, workers: Array<{ id: number; status: string }>) {
  const ends = new Map<number, string>();
  const ids = new Map<number, number>();
  if (!criticalReleaseFlagEnabled("approvedExitPayroll") || workers.length === 0) return { ends, ids };
  const exits = await reader.select({ id: separationRecords.id, employeeId: separationRecords.employeeId,
    lastDay: separationRecords.lastDay, unpaidBasicSalary: separationRecords.unpaidBasicSalary,
    preparedByUserId: separationRecords.preparedByUserId, approvedByUserId: separationRecords.approvedByUserId,
  }).from(separationRecords).where(and(
    eq(separationRecords.organizationId, organizationId),
    inArray(separationRecords.employeeId, workers.map(worker => worker.id)),
    inArray(separationRecords.status, ["approved", "released"]),
  )).orderBy(asc(separationRecords.id));
  for (const exit of exits) {
    if (exit.preparedByUserId == null || exit.approvedByUserId == null || exit.preparedByUserId === exit.approvedByUserId) {
      throw new Error("PAYROLL_EXIT_APPROVAL_IDENTITY: Approved exit requires recorded distinct preparer and checker identities.");
    }
    const date = String(exit.lastDay);
    if (ends.has(exit.employeeId) && ends.get(exit.employeeId) !== date) {
      throw new Error("PAYROLL_SEPARATION_CONFLICT: Multiple approved end dates must be reconciled before payroll.");
    }
    if (Number(exit.unpaidBasicSalary) !== 0) {
      throw new Error("PAYROLL_FINAL_PAY_WAGE_OVERLAP: Approved final pay includes unpaid basic wages. Recompute it without overlapping wages and obtain independent approval before ordinary payroll.");
    }
    ends.set(exit.employeeId, date); ids.set(exit.employeeId, exit.id);
  }
  if (workers.some(worker => worker.status === "Separating" && !ends.has(worker.id))) {
    throw new Error("PAYROLL_EXIT_APPROVAL_REQUIRED: A separating employee lacks an independently approved final-pay package. Resolve approval before payroll; the employee was not silently excluded.");
  }
  return { ends, ids };
}

/** Released capped wages may enter final-pay YTD only with the engine's exit trace. */
export function verifiedExitPayrollTrace(trace: unknown, lastDay: string, separationId: number) {
  if (!Number.isSafeInteger(separationId) || separationId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return false;
  if (!trace || typeof trace !== "object") return false;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return false;
  return ["approvedExitProration=v1", `employmentEnd=${lastDay}`, `approvedSeparationId=${separationId}`]
    .every(value => inputs.includes(value) && inputs.filter(item => typeof item === "string" && item.startsWith(value.split("=")[0] + "=")).length === 1);
}
