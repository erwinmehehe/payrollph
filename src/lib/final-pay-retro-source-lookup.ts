import { and, eq, exists, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employeePayRetroAdjustments, payrollEntries, payrollRuns } from "@/db/schema";

/**
 * M-5: Resolve settled RETRO-* source years from the original, released
 * same-tenant payroll run AND a source entry for the exact employee.
 *
 * A LEFT JOIN is deliberate. A referenced draft/unrelated/foreign run must
 * remain visible with null dates, so final-pay calculation fails closed
 * rather than silently excluding the RETRO line or assuming payout year.
 *
 * Pass the serializable transaction reader from separation; never open an
 * unrelated connection inside a financial source fingerprint.
 */
export async function loadFinalPayRetroSourcePeriods(
  input: {
    organizationId: number;
    employeeId: number;
    adjustmentIds: readonly number[];
  },
  reader: Pick<typeof db, "select"> = db,
) {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0
    || !Number.isSafeInteger(input.employeeId) || input.employeeId <= 0
    || input.adjustmentIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("Invalid M-5 retro source identity.");
  }
  if (input.adjustmentIds.length === 0) {
    return [] as Array<{ id: number; sourcePeriodStart: string | null; sourcePeriodEnd: string | null }>;
  }
  return reader.select({
    id: employeePayRetroAdjustments.id,
    sourcePeriodStart: payrollRuns.periodStart,
    sourcePeriodEnd: payrollRuns.periodEnd,
  })
    .from(employeePayRetroAdjustments)
    .leftJoin(payrollRuns, and(
      eq(employeePayRetroAdjustments.sourcePayrollRunId, payrollRuns.id),
      eq(payrollRuns.organizationId, input.organizationId),
      eq(payrollRuns.status, "Released"),
      exists(reader.select({ id: payrollEntries.id }).from(payrollEntries).where(and(
        eq(payrollEntries.payrollRunId, employeePayRetroAdjustments.sourcePayrollRunId),
        eq(payrollEntries.employeeId, employeePayRetroAdjustments.employeeId),
      ))),
    ))
    .where(and(
      eq(employeePayRetroAdjustments.organizationId, input.organizationId),
      eq(employeePayRetroAdjustments.employeeId, input.employeeId),
      inArray(employeePayRetroAdjustments.id, [...new Set(input.adjustmentIds)]),
    ));
}
