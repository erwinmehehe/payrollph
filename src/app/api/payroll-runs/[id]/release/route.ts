import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollEntries, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { queueMessage } from "@/lib/mailer";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertMembership } from "@/lib/access";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";

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
      assurance: assuranceResult?.assurance.summary ?? null,
    },
  });

  // Notify staff that payslips are ready. Queued in the outbox when no mail
  // provider is configured, never silently reported as sent.
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, run.organizationId));
  const staff = await db.select().from(employees).where(eq(employees.organizationId, run.organizationId));
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
