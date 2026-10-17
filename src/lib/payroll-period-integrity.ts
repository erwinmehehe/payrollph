import { and, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
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

type PeriodQueryExecutor = Pick<typeof db, "select">;

export async function findPayrollPeriodConflict(input: PayrollPeriodIdentity & {
  excludeRunId?: number;
  conflictStatuses?: readonly string[];
  executor?: PeriodQueryExecutor;
}) {
  const executor = input.executor ?? db;
  const legalEntityCondition = input.legalEntityId == null
    ? isNull(payrollRuns.legalEntityId)
    : eq(payrollRuns.legalEntityId, input.legalEntityId);

  const rows = await executor
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

export type ReleaseClaimResult =
  | { status: "claimed"; run: typeof payrollRuns.$inferSelect }
  | { status: "period-conflict"; conflict: NonNullable<Awaited<ReturnType<typeof findPayrollPeriodConflict>>> | null }
  | { status: "not-ready" };

/**
 * Atomically claim Ready for release -> Releasing for one run.
 *
 * The overlap check and the claim must be one critical section per employer.
 * Checking first and claiming later lets two overlapping runs both pass the
 * check under READ COMMITTED and both reach Releasing. The database exclusion
 * constraint from drizzle/0089 is a backstop, but it is not declared in
 * schema.ts, so databases built by `drizzle-kit push` do not have it. This
 * function does not depend on it: a transaction-scoped advisory lock per
 * organization serializes the check and the claim, and a late constraint
 * violation (23P01) or lock timeout is reported as a period conflict.
 */
export async function claimPayrollRunForRelease(run: {
  id: number;
  organizationId: number;
  legalEntityId: number | null;
  scopeOrgUnitId: number | null;
  periodStart: string | Date;
  periodEnd: string | Date;
}): Promise<ReleaseClaimResult> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5000ms'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"payrollph:release-claim:" + run.organizationId}, 0))`);
      const conflict = await findPayrollPeriodConflict({
        organizationId: run.organizationId,
        legalEntityId: run.legalEntityId,
        scopeOrgUnitId: run.scopeOrgUnitId,
        periodStart: String(run.periodStart),
        periodEnd: String(run.periodEnd),
        excludeRunId: run.id,
        conflictStatuses: ["Releasing", "Released"],
        executor: tx,
      });
      if (conflict) return { status: "period-conflict" as const, conflict };
      const [claimed] = await tx.update(payrollRuns)
        .set({ status: "Releasing" })
        .where(and(eq(payrollRuns.id, run.id), eq(payrollRuns.status, "Ready for release")))
        .returning();
      return claimed ? { status: "claimed" as const, run: claimed } : { status: "not-ready" as const };
    });
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    // exclusion_violation, deadlock_detected, lock_not_available: another
    // release for an overlapping population is in progress.
    if (code === "23P01" || code === "40P01" || code === "55P03") {
      return { status: "period-conflict", conflict: null };
    }
    throw error;
  }
}
