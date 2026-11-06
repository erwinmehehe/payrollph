import { and, desc, eq, lt } from "drizzle-orm";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { parseSelfPayExplanationEntryId } from "@/lib/self-pay-explanation-entry-id";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns } from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayExplanation } from "@/lib/payroll-explain";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;
const missingEntry = () => Response.json({ error: "Pay explanation not found." },
  { status: 404, headers: PRIVATE_HEADERS });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (session.role !== "employee" || !session.employeeId) {
    return Response.json({ error: "Self-service account required." }, { status: 403 });
  }

  // Canonical, positive IDs reject aliases and unsafe integers before any
  // globally addressed payroll-entry lookup occurs.
  const entryId = parseSelfPayExplanationEntryId((await params).id);
  if (entryId === null) return missingEntry();

  const [employee] = await db.select({
    id: employees.id,
    organizationId: employees.organizationId,
    legalEntityId: employees.legalEntityId,
  }).from(employees)
    .where(eq(employees.id, session.employeeId))
    .limit(1);
  if (!employee) return missingEntry();

  // A stale account-to-employee link must not grant the former employer's
  // payroll data after the workspace membership has been revoked.
  const membershipDenied = await assertMembership(session.id, employee.organizationId);
  if (membershipDenied) return membershipDenied;

  // In multi-entity mode the employee's legal-employer attribution must be
  // explicit. A missing attribution must never fall back to group-wide reads.
  const multiEntityEnabled = criticalReleaseFlagEnabled("multiEntity");
  if (multiEntityEnabled && (!Number.isSafeInteger(employee.legalEntityId) || (employee.legalEntityId ?? 0) <= 0)) {
    return Response.json({ error: "Employee legal-employer attribution is required." },
      { status: 409, headers: PRIVATE_HEADERS });
  }

  const [row] = await db
    .select({ entry: payrollEntries, run: payrollRuns })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollEntries.id, entryId),
      eq(payrollEntries.employeeId, session.employeeId),
      eq(payrollRuns.organizationId, employee.organizationId),
      eq(payrollRuns.status, "Released"),
      multiEntityEnabled ? eq(payrollRuns.legalEntityId, employee.legalEntityId!) : undefined,
    ))
    .limit(1);

  if (!row) return missingEntry();

  const { entry, run } = row;
  // Find the previous *payslip for this employee*, not the previous payroll
  // run for the whole company. Otherwise an unrelated colleague's run metadata
  // could be shown as previousRun and the comparison would silently be empty.
  // A single joined query also keeps the returned prior run and entry paired.
  const [previous] = await db
    .select({ previousRun: payrollRuns, previousEntry: payrollEntries })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollEntries.employeeId, session.employeeId),
      eq(payrollRuns.organizationId, employee.organizationId),
      eq(payrollRuns.status, "Released"),
      lt(payrollRuns.payDate, run.payDate),
      multiEntityEnabled ? eq(payrollRuns.legalEntityId, employee.legalEntityId!) : undefined,
    ))
    .orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id), desc(payrollEntries.id))
    .limit(1);

  return Response.json({
    organizationId: employee.organizationId,
    employeeId: session.employeeId,
    entryId,
    run: {
      id: run.id,
      periodLabel: run.periodLabel,
      payDate: run.payDate,
      ruleVersion: run.ruleVersion,
    },
    previousRun: previous
      ? {
          id: previous.previousRun.id,
          periodLabel: previous.previousRun.periodLabel,
          payDate: previous.previousRun.payDate,
          ruleVersion: previous.previousRun.ruleVersion,
        }
      : null,
    explanation: buildPayExplanation(entry, previous?.previousEntry ?? null),
  }, { headers: PRIVATE_HEADERS });
}
