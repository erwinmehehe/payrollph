import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, employees, organizations, payrollEntries, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { queueMessage } from "@/lib/mailer";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { settlePayrollRun } from "@/lib/payroll-settlement";

const RELEASABLE = ["Ready for release"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });
  const deniedOrg = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can release payroll.",
  );
  if (deniedOrg) return deniedOrg;

  if (run.status === "Released") {
    return Response.json({ error: "This run is already released." }, { status: 409 });
  }

  const [{ value: entryCount }] = await db
    .select({ value: count() })
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, runId));

  if (entryCount === 0) {
    return Response.json({ error: "Run has no calculated entries, process the payroll first." }, { status: 409 });
  }
  if (!RELEASABLE.includes(run.status)) {
    return Response.json({ error: `Run must be processed before release (currently ${run.status}).` }, { status: 409 });
  }

  const approvalRows = await db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, run.organizationId));
  const payrollApproval = approvalRows
    .filter((task) => task.detail.includes(`Payroll run #${run.id}`))
    .sort((a, b) => b.id - a.id)[0];

  if (!payrollApproval || payrollApproval.status !== "Approved") {
    return Response.json({
      error: "Payroll must be approved by a checker before release.",
      approvalStatus: payrollApproval?.status ?? "Not submitted",
    }, { status: 409 });
  }

  const assuranceResult = await buildPayrollAssurance(runId);
  const blockingFindings = assuranceResult?.assurance.findings.filter((finding) => finding.blocking) ?? [];
  if (blockingFindings.length > 0) {
    return Response.json({
      error: `Payroll assurance found ${blockingFindings.length} blocking issue(s). Resolve them before release.`,
      blockingFindings,
    }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  if (run.exceptions > 0 && !body.acknowledgeExceptions) {
    return Response.json({
      error: `${run.exceptions} exception(s) need sign-off. Re-send with acknowledgeExceptions: true to release anyway.`,
      exceptions: run.exceptions,
    }, { status: 409 });
  }

  // Claim the release transition atomically so two concurrent requests cannot
  // settle the same ledgers twice.
  const [claimed] = await db.update(payrollRuns)
    .set({ status: "Releasing" })
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "Ready for release")))
    .returning();

  if (!claimed) {
    return Response.json({ error: "Payroll is no longer ready for release. Refresh and review its current status." }, { status: 409 });
  }

  let settlement;
  let updated;
  try {
    const released = await settlePayrollRun(runId);
    settlement = released.settlement;
    updated = released.run;
  } catch (error) {
    // The settlement transaction rolled back every ledger mutation. Only the
    // earlier release claim lives outside that transaction, so restore it for a
    // safe recalculation/retry.
    await db.update(payrollRuns)
      .set({ status: "Ready for release" })
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "Releasing")));
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll settlement failed; recalculate before release.",
    }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: user.name,
    action: "Payroll released",
    resource: run.periodLabel,
    metadata: {
      runId,
      ruleVersion: run.ruleVersion,
      netPay: run.netPay,
      employees: entryCount,
      exceptionsAcknowledged: run.exceptions > 0 ? run.exceptions : 0,
      assurance: assuranceResult?.assurance.summary ?? null,
      approvalTaskId: payrollApproval.id,
      approvedBy: payrollApproval.decidedBy ?? payrollApproval.approver,
      settlement,
    },
  });

  // Notify staff that payslips are ready. Queued in the outbox when no mail
  // provider is configured, never silently reported as sent.
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, run.organizationId));
  const releasedEntries = await db
    .select({ employeeId: payrollEntries.employeeId })
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, runId));
  const releasedEmployeeIds = [...new Set(releasedEntries.map((entry) => entry.employeeId))];
  const staff = releasedEmployeeIds.length
    ? await db.select().from(employees).where(and(
        eq(employees.organizationId, run.organizationId),
        inArray(employees.id, releasedEmployeeIds),
      ))
    : [];
  const notified = staff.filter((person) => person.status === "Active" && Boolean(person.email)).length;
  for (const person of staff) {
    if (person.status !== "Active" || !person.email) continue;
    await queueMessage({
      organizationId: run.organizationId,
      recipient: person.email,
      subject: `Your payslip for ${run.periodLabel} is ready`,
      purpose: "payslip-ready",
      body: [
        `Hi ${person.firstName},`,
        "",
        `${organization?.name ?? "Your employer"} released payroll for ${run.periodLabel}.`,
        "",
        "Sign in to Linaw to view and download your payslip.",
      ].join("\n"),
    });
  }

  const deliveries = await dispatchWebhook({
    organizationId: run.organizationId,
    event: "payroll.released",
    data: {
      runId,
      period: run.periodLabel,
      payDate: run.payDate,
      employees: entryCount,
      grossPay: run.grossPay,
      netPay: run.netPay,
    },
  });

  return Response.json({ run: updated, webhookDeliveries: deliveries.length, employeesNotified: notified });
}
