import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employeePayRevisions, employees, payrollEntries, payrollRuns } from "@/db/schema";
import { assertOrganizationRole, assertOrganizationUnitAccess, PAYROLL_VIEW_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayExplanation } from "@/lib/payroll-explain";
import { classifyPayrollVariance, type PayrollVarianceCategory } from "@/lib/payroll-variance";

export const dynamic = "force-dynamic";

const zeroEntry = {
  grossPay: "0",
  deductions: "0",
  netPay: "0",
  lineItems: [],
  trace: {},
};

function employeeIdFromAudit(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const row = metadata as Record<string, unknown>;
  const value = Number(row.employeeId ?? row.employee_id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isBankDetailEvent(action: string, resource: string) {
  const text = `${action} ${resource}`.toLowerCase();
  return (
    text.includes("bank detail") ||
    text.includes("bank account") ||
    text.includes("payout detail") ||
    text.includes("payout account")
  );
}

function categoryCounts(rows: Array<{ categories: PayrollVarianceCategory[] }>) {
  const counts: Record<PayrollVarianceCategory, number> = {
    exception: 0,
    salary_change: 0,
    overtime_spike: 0,
    retro: 0,
    new_hire: 0,
    new_to_run: 0,
    separation: 0,
    missing_from_run: 0,
    bank_details: 0,
    statutory: 0,
    net_variance: 0,
  };
  for (const row of rows) {
    for (const category of row.categories) counts[category] += 1;
  }
  return counts;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: "Invalid payroll run id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_VIEW_ROLES,
    "Your role cannot inspect payroll variance.",
  );
  if (denied) return denied;

  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

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

  const previousRun = priorRuns.find((candidate) => candidate.scopeOrgUnitId === run.scopeOrgUnitId) ?? null;

  const [currentEntries, previousEntries] = await Promise.all([
    db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id)),
    previousRun
      ? db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, previousRun.id))
      : Promise.resolve([]),
  ]);

  const employeeIds = [...new Set([
    ...currentEntries.map((entry) => entry.employeeId),
    ...previousEntries.map((entry) => entry.employeeId),
  ])];

  const periodStart = new Date(`${run.periodStart}T00:00:00.000Z`);
  const periodEnd = new Date(`${run.periodEnd}T23:59:59.999Z`);

  const [employeeRows, relevantRevisions, periodAudit] = employeeIds.length
    ? await Promise.all([
        db.select().from(employees).where(and(
          eq(employees.organizationId, run.organizationId),
          inArray(employees.id, employeeIds),
        )),
        db.select().from(employeePayRevisions).where(and(
          eq(employeePayRevisions.organizationId, run.organizationId),
          inArray(employeePayRevisions.employeeId, employeeIds),
          gte(employeePayRevisions.effectiveDate, run.periodStart),
          lte(employeePayRevisions.effectiveDate, run.periodEnd),
        )),
        db.select().from(auditEvents).where(and(
          eq(auditEvents.organizationId, run.organizationId),
          gte(auditEvents.createdAt, periodStart),
          lte(auditEvents.createdAt, periodEnd),
        )),
      ])
    : [[], [], []];

  const employeeById = new Map(employeeRows.map((employee) => [employee.id, employee]));
  const currentByEmployee = new Map(currentEntries.map((entry) => [entry.employeeId, entry]));
  const previousByEmployee = new Map(previousEntries.map((entry) => [entry.employeeId, entry]));
  const revisionByEmployee = new Map(relevantRevisions.map((revision) => [revision.employeeId, revision]));

  const bankChangedEmployees = new Set(
    periodAudit
      .filter((event) => isBankDetailEvent(event.action, event.resource))
      .map((event) => employeeIdFromAudit(event.metadata))
      .filter((employeeId): employeeId is number => employeeId != null && employeeIds.includes(employeeId)),
  );

  const rows = employeeIds.flatMap((employeeId) => {
    const employee = employeeById.get(employeeId);
    if (!employee) return [];

    const current = currentByEmployee.get(employeeId) ?? null;
    const previous = previousByEmployee.get(employeeId) ?? null;
    const explanation = buildPayExplanation(current ?? zeroEntry, previous);
    const revision = revisionByEmployee.get(employeeId) ?? null;
    const isNewHire = employee.startDate >= run.periodStart && employee.startDate <= run.periodEnd;

    const categories = classifyPayrollVariance({
      explanation,
      currentStatus: current?.status,
      employeeStatus: employee.status,
      hasCurrentEntry: Boolean(current),
      hasPreviousEntry: Boolean(previous),
      hasPayRevision: Boolean(revision),
      isNewHire,
      bankDetailsChanged: bankChangedEmployees.has(employeeId),
    });

    const changedLines = explanation.lines
      .filter((line) => line.delta != null && Math.abs(line.delta) >= 0.01)
      .slice(0, 5)
      .map((line) => ({
        code: line.code,
        label: line.label,
        previous: line.previous,
        current: line.current,
        delta: line.delta,
        netEffectDelta: line.netEffectDelta,
        reason: line.reason,
      }));

    return [{
      employeeId,
      employeeNo: employee.employeeNo,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeStatus: employee.status,
      entryStatus: current?.status ?? "Not in current run",
      categories,
      currentGross: explanation.currentGross,
      previousGross: explanation.previousGross,
      currentNet: explanation.currentNet,
      previousNet: explanation.previousNet,
      netDelta: explanation.netDelta,
      netPercent: explanation.netPercent,
      changedLines,
      payRevision: revision
        ? {
            effectiveDate: revision.effectiveDate,
            previousPayBasis: revision.previousPayBasis,
            previousRateAmount: revision.previousRateAmount,
            newPayBasis: revision.newPayBasis,
            newRateAmount: revision.newRateAmount,
            reason: revision.reason,
          }
        : null,
    }];
  }).sort((a, b) => {
    const aException = a.categories.includes("exception") ? 1 : 0;
    const bException = b.categories.includes("exception") ? 1 : 0;
    if (aException !== bException) return bException - aException;
    return Math.abs(b.netDelta ?? b.currentNet) - Math.abs(a.netDelta ?? a.currentNet);
  });

  const changedRows = rows.filter((row) => row.categories.length > 0);
  const netDelta = Number(run.netPay) - Number(previousRun?.netPay ?? 0);
  const grossDelta = Number(run.grossPay) - Number(previousRun?.grossPay ?? 0);

  return Response.json({
    run: {
      id: run.id,
      periodLabel: run.periodLabel,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      payDate: run.payDate,
      status: run.status,
      employeeCount: run.employeeCount,
      grossPay: Number(run.grossPay),
      netPay: Number(run.netPay),
      ruleVersion: run.ruleVersion,
    },
    previousRun: previousRun
      ? {
          id: previousRun.id,
          periodLabel: previousRun.periodLabel,
          payDate: previousRun.payDate,
          employeeCount: previousRun.employeeCount,
          grossPay: Number(previousRun.grossPay),
          netPay: Number(previousRun.netPay),
          ruleVersion: previousRun.ruleVersion,
        }
      : null,
    summary: {
      changedEmployees: changedRows.length,
      totalEmployeesReviewed: rows.length,
      calculatedEntries: currentEntries.length,
      expectedEntries: Number(run.employeeCount),
      coverageComplete:
        Number(run.employeeCount) > 0
        && currentEntries.length === Number(run.employeeCount)
        && Number(run.totalChunks ?? 0) > 0
        && Number(run.processedChunks ?? 0) >= Number(run.totalChunks ?? 0),
      exceptionCount: currentEntries.filter((entry) => entry.status === "Exception").length,
      grossDelta,
      netDelta,
      categoryCounts: categoryCounts(changedRows),
    },
    rows: changedRows,
  });
}
