import { and, desc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";

const NON_BLOCKING_STATUSES = new Set(["Failed", "Cancelled", "Voided", "Superseded"]);

export type PayrollPeriodIdentity = {
  organizationId: number;
  legalEntityId: number | null;
  scopeOrgUnitId: number | null;
  periodStart: string;
  periodEnd: string;
};

export function payrollPeriodsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
) {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * A company-wide payroll (null scope) contains every org unit. Two explicitly
 * scoped payrolls overlap only when they target the same org unit.
 */
export function payrollScopesOverlap(a: number | null, b: number | null) {
  return a == null || b == null || a === b;
}

export async function findPayrollPeriodConflict(input: PayrollPeriodIdentity & {
  excludeRunId?: number;
  conflictStatuses?: readonly string[];
}) {
  const legalEntityCondition = input.legalEntityId == null
    ? isNull(payrollRuns.legalEntityId)
    : eq(payrollRuns.legalEntityId, input.legalEntityId);

  const rows = await db
    .select({
      id: payrollRuns.id,
      periodLabel: payrollRuns.periodLabel,
      periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd,
      scopeOrgUnitId: payrollRuns.scopeOrgUnitId,
      status: payrollRuns.status,
    })
    .from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, input.organizationId),
      legalEntityCondition,
      lte(payrollRuns.periodStart, input.periodEnd),
      gte(payrollRuns.periodEnd, input.periodStart),
      input.excludeRunId ? ne(payrollRuns.id, input.excludeRunId) : undefined,
    ))
    .orderBy(desc(payrollRuns.id));

  const allowedStatuses = input.conflictStatuses
    ? new Set(input.conflictStatuses)
    : null;

  return rows.find((row) => {
    if (allowedStatuses) {
      if (!allowedStatuses.has(row.status)) return false;
    } else if (NON_BLOCKING_STATUSES.has(row.status)) {
      return false;
    }

    return payrollScopesOverlap(row.scopeOrgUnitId, input.scopeOrgUnitId)
      && payrollPeriodsOverlap(
        String(row.periodStart),
        String(row.periodEnd),
        input.periodStart,
        input.periodEnd,
      );
  }) ?? null;
}
