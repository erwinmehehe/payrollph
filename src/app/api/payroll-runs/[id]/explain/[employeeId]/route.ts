import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { payrollEntries, payrollRuns } from "@/db/schema";
import { assertOrganizationRole, PAYROLL_VIEW_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayExplanation } from "@/lib/payroll-explain";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; employeeId: string }> }) {
  const { id, employeeId: employeeParam } = await params;
  const runId = Number(id);
  const employeeId = Number(employeeParam);
  if (!Number.isInteger(runId) || !Number.isInteger(employeeId)) {
    return Response.json({ error: "Invalid payroll run or employee id." }, { status: 400 });
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });
  const denied = await assertOrganizationRole(user.id, run.organizationId, PAYROLL_VIEW_ROLES, "Your role cannot inspect payroll explanations.");
  if (denied) return denied;
  const [entry] = await db.select().from(payrollEntries).where(and(eq(payrollEntries.payrollRunId, run.id), eq(payrollEntries.employeeId, employeeId))).limit(1);
  if (!entry) return Response.json({ error: "Payroll entry not found for this employee." }, { status: 404 });
  const [previousRun] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, run.organizationId),
    eq(payrollRuns.status, "Released"),
    lt(payrollRuns.payDate, run.payDate),
  )).orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id)).limit(1);
  const [previousEntry] = previousRun
    ? await db.select().from(payrollEntries).where(and(eq(payrollEntries.payrollRunId, previousRun.id), eq(payrollEntries.employeeId, employeeId))).limit(1)
    : [];
  return Response.json({
    run: { id: run.id, periodLabel: run.periodLabel, payDate: run.payDate, ruleVersion: run.ruleVersion },
    previousRun: previousRun ? { id: previousRun.id, periodLabel: previousRun.periodLabel, payDate: previousRun.payDate, ruleVersion: previousRun.ruleVersion } : null,
    explanation: buildPayExplanation(entry, previousEntry ?? null),
  });
}
