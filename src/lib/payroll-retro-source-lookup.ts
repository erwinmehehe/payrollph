import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employeePayRetroAdjustments, payrollRuns } from "@/db/schema";

/**
 * M-10: Use the actual original run dates to screen retro statutory
 * attribution. An editable sourcePeriodLabel is never contribution evidence.
 *
 * The join must include BOTH run ID and organization ID: historical FK rows
 * may point to a different tenant's run, and date leakage would otherwise
 * silently make cross-tenant payroll appear verified.
 *
 * No writes, legacy backfill, bank access, or live remittance.
 */
export async function loadPendingPayrollRetroSources(input: {
  organizationId: number;
  employeeIds: readonly number[];
}) {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0
    || input.employeeIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("Invalid retro source tenant or worker identity");
  }
  if (input.employeeIds.length === 0) return [];
  return db.select({
    id: employeePayRetroAdjustments.id,
    employeeId: employeePayRetroAdjustments.employeeId,
    amount: employeePayRetroAdjustments.amount,
    sourcePeriodLabel: employeePayRetroAdjustments.sourcePeriodLabel,
    sourcePeriodStart: payrollRuns.periodStart,
    sourcePeriodEnd: payrollRuns.periodEnd,
  }).from(employeePayRetroAdjustments).leftJoin(payrollRuns, and(
    eq(payrollRuns.id, employeePayRetroAdjustments.sourcePayrollRunId),
    eq(payrollRuns.organizationId, employeePayRetroAdjustments.organizationId),
  )).where(and(
    eq(employeePayRetroAdjustments.organizationId, input.organizationId),
    eq(employeePayRetroAdjustments.status, "pending"),
    inArray(employeePayRetroAdjustments.employeeId, [...input.employeeIds]),
  ));
}
