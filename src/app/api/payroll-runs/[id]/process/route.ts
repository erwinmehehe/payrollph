import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, employees, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { drainPayrollQueue, enqueuePayrollRun } from "@/lib/payroll-engine";
import { assertOrganizationRole, assertOrganizationUnitAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { loadTimesheetPayrollGate } from "@/lib/workforce-timesheet-server";
import { loadAttendanceCutoffGate } from "@/lib/workforce-attendance-lock";
import { requireSaasPaidWrites } from "@/lib/saas-workspace-access";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(_request);
  if (originDenied) return originDenied;

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id" }, { status: 400 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found" }, { status: 404 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can calculate payroll.",
  );
  if (deniedOrg) return deniedOrg;
  const subscriptionDenied = await requireSaasPaidWrites(run.organizationId);
  if (subscriptionDenied) return subscriptionDenied;
  const deniedUnit = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (deniedUnit) return deniedUnit;

  if (run.status === "Released" || run.status === "Releasing") {
    return Response.json({ error: "Released or releasing payroll is immutable and cannot be recalculated." }, { status: 409 });
  }
  if (["Queued", "Processing", "Recalculating"].includes(run.status)) {
    return Response.json({ error: `Payroll calculation is already in progress (currently ${run.status}).` }, { status: 409 });
  }

  const employeeRows = await db.select({ id: employees.id }).from(employees).where(
    run.scopeOrgUnitId == null
      ? and(
          eq(employees.organizationId, run.organizationId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        )
      : and(
          eq(employees.organizationId, run.organizationId),
          eq(employees.orgUnitId, run.scopeOrgUnitId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        ),
  );
  const attendanceCutoffGate = await loadAttendanceCutoffGate({
    organizationId: run.organizationId,
    periodStart: String(run.periodStart),
    periodEnd: String(run.periodEnd),
  });
  if (!attendanceCutoffGate.gate.allowed) {
    return Response.json({
      error: "An active payroll-cutoff attendance lock is required before payroll recalculation for this organization.",
      code: "ATTENDANCE_CUTOFF_LOCK_REQUIRED",
      attendanceCutoffGate: attendanceCutoffGate.gate,
    }, { status: 422 });
  }

  const timesheetGate = await loadTimesheetPayrollGate({
    organizationId: run.organizationId,
    employeeIds: employeeRows.map((employee) => employee.id),
    periodStart: String(run.periodStart),
    periodEnd: String(run.periodEnd),
  });
  if (!timesheetGate.gate.allowed) {
    return Response.json({
      error: "Approved workforce timesheets are required before payroll recalculation for this organization.",
      code: "TIMESHEET_APPROVAL_REQUIRED",
      timesheetGate: timesheetGate.gate,
    }, { status: 422 });
  }

  // Claim the recalculation state before invalidating approvals. Submit-for-
  // review uses its own conditional state claim, so the two operations cannot
  // both win from the same source state under concurrent requests.
  const recalculation = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(payrollRuns)
      .set({ status: "Recalculating" })
      .where(and(
        eq(payrollRuns.id, runId),
        eq(payrollRuns.status, run.status),
      ))
      .returning();

    if (!claimed) return null;

    const approvalRows = await tx
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.organizationId, run.organizationId));
    const linkedApprovals = approvalRows
      .filter((task) => task.detail.includes(`Payroll run #${run.id}`))
      .filter((task) => task.status === "Pending" || task.status === "Approved");

    const superseded: number[] = [];
    for (const task of linkedApprovals) {
      const [updated] = await tx.update(approvalTasks)
        .set({ status: "Superseded", decidedBy: "System", decidedAt: new Date() })
        .where(and(
          eq(approvalTasks.id, task.id),
          eq(approvalTasks.status, task.status),
        ))
        .returning();
      if (updated) superseded.push(updated.id);
    }

    return { claimed, superseded };
  });

  if (!recalculation) {
    return Response.json({
      error: "Payroll state changed while recalculation was starting. Refresh and retry.",
    }, { status: 409 });
  }

  let queue;
  let processResult;
  try {
    queue = await enqueuePayrollRun(runId);
    processResult = await drainPayrollQueue(50, runId);
  } catch (error) {
    await db.update(payrollRuns)
      .set({ status: "Failed" })
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "Recalculating")));
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll recalculation could not be queued.",
    }, { status: 500 });
  }

  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: user.name,
    action: "Payroll processing requested",
    resource: run.periodLabel,
    metadata: {
      runId,
      ruleVersion: "PH-2026.01",
      chunks: processResult.length,
      approvalsSuperseded: recalculation.superseded,
      attendanceCutoffPolicy: attendanceCutoffGate.policy,
      attendanceCutoffGate: attendanceCutoffGate.gate,
      timesheetPolicy: timesheetGate.policy,
      timesheetGate: timesheetGate.gate,
    },
  });

  return Response.json({ run: fresh, queue, processResult, attendanceCutoffGate, timesheetGate });
}
