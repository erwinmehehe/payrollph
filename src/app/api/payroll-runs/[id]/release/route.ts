import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, employees, organizations, payrollEntries, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { queueMessage } from "@/lib/mailer";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertMembership } from "@/lib/access";
import { auditPayrollControl } from "@/lib/payroll-control";

const RELEASABLE = ["Ready for release", "Needs review", "Processed"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });
  const deniedOrg = await assertMembership(user.id, run.organizationId);
  if (deniedOrg) return deniedOrg;

  if (run.status === "Released") {
    return Response.json({ error: "This run is already released." }, { status: 409 });
  }

  const entryRows = await db
    .select()
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, runId));

  const entryCount = entryRows.length;
  if (entryCount === 0) {
    return Response.json({ error: "Run has no calculated entries, process the payroll first." }, { status: 409 });
  }

  const staffForAudit = await db.select().from(employees).where(eq(employees.organizationId, run.organizationId));
  const payrollAudit = auditPayrollControl({
    entries: entryRows,
    employees: staffForAudit,
  });

  if (payrollAudit.readiness.highCount > 0) {
    return Response.json({
      error: `Payroll Control Center found ${payrollAudit.readiness.highCount} blocking issue(s). Resolve them before release.`,
      blockingIssues: payrollAudit.issues.filter((issue) => issue.severity === "high"),
    }, { status: 409 });
  }

  const tasks = await db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, run.organizationId));
  const period = run.periodLabel.toLowerCase();
  const approval =
    tasks.find((task) => task.title.toLowerCase().includes(period)) ??
    tasks.find((task) => task.title.toLowerCase().includes("payroll") && task.status === "Pending");

  if (approval && approval.status !== "Approved") {
    return Response.json({
      error:
        approval.status === "Declined"
          ? "The configured payroll approval was declined. Resolve the approval before release."
          : `Payroll is still waiting for approval from ${approval.approver}.`,
      approval: {
        id: approval.id,
        title: approval.title,
        status: approval.status,
        approver: approval.approver,
      },
    }, { status: 409 });
  }
  if (!RELEASABLE.includes(run.status)) {
    return Response.json({ error: `Run must be processed before release (currently ${run.status}).` }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  if (run.exceptions > 0 && !body.acknowledgeExceptions) {
    return Response.json({
      error: `${run.exceptions} exception(s) need sign-off. Re-send with acknowledgeExceptions: true to release anyway.`,
      exceptions: run.exceptions,
    }, { status: 409 });
  }

  const [updated] = await db.update(payrollRuns)
    .set({ status: "Released" })
    .where(eq(payrollRuns.id, runId))
    .returning();

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
      payrollAudit: {
        high: payrollAudit.readiness.highCount,
        medium: payrollAudit.readiness.mediumCount,
      },
      approvalTaskId: approval?.id ?? null,
    },
  });

  // Notify staff that payslips are ready. Queued in the outbox when no mail
  // provider is configured, never silently reported as sent.
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, run.organizationId));
  const staff = staffForAudit;
  const notified = staff.filter((person) => person.status === "Active").length;
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
