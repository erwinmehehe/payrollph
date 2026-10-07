import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns } from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayExplanation } from "@/lib/payroll-explain";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (session.role !== "employee" || !session.employeeId) {
    return Response.json({ error: "Self-service account required." }, { status: 403 });
  }

  const entryId = Number((await params).id);
  if (!Number.isInteger(entryId)) {
    return Response.json({ error: "Pay explanation not found." }, { status: 404 });
  }

  const [employee] = await db.select().from(employees)
    .where(eq(employees.id, session.employeeId))
    .limit(1);
  if (!employee) return Response.json({ error: "Pay explanation unavailable." }, { status: 404 });

  const membershipDenied = await assertMembership(session.id, employee.organizationId);
  if (membershipDenied) return membershipDenied;

  const [row] = await db
    .select({ entry: payrollEntries, run: payrollRuns })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollEntries.id, entryId),
      eq(payrollEntries.employeeId, session.employeeId),
      eq(payrollRuns.organizationId, employee.organizationId),
      eq(payrollRuns.status, "Released"),
    ))
    .limit(1);

  if (!row) {
    return Response.json({ error: "Pay explanation not found." }, { status: 404 });
  }

  const { entry, run } = row;
  const [previousRun] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, employee.organizationId),
    eq(payrollRuns.status, "Released"),
    lt(payrollRuns.payDate, run.payDate),
  )).orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id)).limit(1);

  const [previousEntry] = previousRun
    ? await db.select().from(payrollEntries).where(and(
        eq(payrollEntries.payrollRunId, previousRun.id),
        eq(payrollEntries.employeeId, session.employeeId),
      )).limit(1)
    : [];

  return Response.json({
    run: {
      id: run.id,
      periodLabel: run.periodLabel,
      payDate: run.payDate,
      ruleVersion: run.ruleVersion,
    },
    previousRun: previousRun
      ? {
          id: previousRun.id,
          periodLabel: previousRun.periodLabel,
          payDate: previousRun.payDate,
          ruleVersion: previousRun.ruleVersion,
        }
      : null,
    explanation: buildPayExplanation(entry, previousEntry ?? null),
  });
}
