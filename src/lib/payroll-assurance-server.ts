import { and, asc, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { payrollEntries, payrollRuns } from "@/db/schema";
import { evaluatePayrollAssurance } from "@/lib/payroll-assurance";

export async function buildPayrollAssurance(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return null;

  const currentEntries = await db
    .select()
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, run.id))
    .orderBy(asc(payrollEntries.id));

  const [previousRun] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.organizationId, run.organizationId), lt(payrollRuns.id, run.id)))
    .orderBy(desc(payrollRuns.id))
    .limit(1);

  const previousEntries = previousRun
    ? await db
        .select()
        .from(payrollEntries)
        .where(eq(payrollEntries.payrollRunId, previousRun.id))
        .orderBy(asc(payrollEntries.id))
    : [];

  return {
    run,
    previousRun: previousRun ?? null,
    assurance: evaluatePayrollAssurance(currentEntries, previousEntries),
  };
}
