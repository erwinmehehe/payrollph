import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { assertOrganizationRole, assertOrganizationUnitAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  activeMailProvider,
  deliveryCapable,
  payrollRunOutboxHealth,
  recentOutbox,
  retryOutboxMessage,
  retryPayrollRunOutbox,
} from "@/lib/mailer";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function accessRun(userId: number, organizationId: number, payrollRunId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, payrollRunId)).limit(1);
  if (!run || run.organizationId !== organizationId) {
    return { run: null, denied: Response.json({ error: "Payroll run not found in this workspace." }, { status: 404 }) };
  }

  const scopeDenied = await assertOrganizationUnitAccess(
    userId,
    organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  return { run, denied: scopeDenied };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const payrollRunId = Number(url.searchParams.get("payrollRunId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can view the email outbox.",
  );
  if (denied) return denied;

  if (Number.isInteger(payrollRunId)) {
    const access = await accessRun(user.id, organizationId, payrollRunId);
    if (access.denied) return access.denied;

    const health = await payrollRunOutboxHealth(organizationId, payrollRunId);
    return Response.json({
      provider: activeMailProvider(),
      deliveryCapable: deliveryCapable(),
      payrollRunId,
      health: {
        total: health.total,
        sent: health.sent,
        failed: health.failed,
        queued: health.queued,
        sending: health.sending,
        healthy: health.healthy,
      },
      messages: health.messages.map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        recipient: row.recipient,
        subject: row.subject,
        purpose: row.purpose,
        status: row.status,
        provider: row.provider,
        providerMessageId: row.providerMessageId,
        attemptCount: row.attemptCount,
        lastAttemptAt: row.lastAttemptAt,
        nextAttemptAt: row.nextAttemptAt,
        error: row.error,
        sentAt: row.sentAt,
        createdAt: row.createdAt,
      })),
      note: "Queued and failed messages remain durable. Due failed email deliveries are retried by the scheduler.",
    });
  }

  const rows = await recentOutbox(50, organizationId);
  return Response.json({
    provider: activeMailProvider(),
    deliveryCapable: deliveryCapable(),
    messages: rows.map((row) => ({
      id: row.id,
      payrollRunId: row.payrollRunId,
      employeeId: row.employeeId,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject,
      purpose: row.purpose,
      status: row.status,
      provider: row.provider,
      providerMessageId: row.providerMessageId,
      attemptCount: row.attemptCount,
      lastAttemptAt: row.lastAttemptAt,
      nextAttemptAt: row.nextAttemptAt,
      error: row.error,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    })),
    note: "Messages stay queued while no provider is configured. Failed email deliveries are retried with capped backoff.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Email delivery retry");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const payrollRunId = Number(body.payrollRunId);
  const messageId = Number(body.messageId);

  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can retry email delivery.",
  );
  if (denied) return denied;

  if (Number.isInteger(payrollRunId)) {
    const access = await accessRun(user.id, organizationId, payrollRunId);
    if (access.denied) return access.denied;

    const results = await retryPayrollRunOutbox(organizationId, payrollRunId);
    const sent = results.filter((result) => result.delivered).length;
    const failed = results.filter((result) => !result.delivered && !result.queued).length;
    const queued = results.filter((result) => result.queued).length;

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Payroll email delivery retried",
      resource: access.run!.periodLabel,
      metadata: {
        runId: payrollRunId,
        attempted: results.length,
        sent,
        failed,
        queued,
      },
    });

    return Response.json({
      payrollRunId,
      attempted: results.length,
      sent,
      failed,
      queued,
      results,
    });
  }

  if (!Number.isInteger(messageId)) {
    return Response.json({ error: "messageId or payrollRunId is required." }, { status: 400 });
  }

  try {
    const result = await retryOutboxMessage(messageId, organizationId);
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Email delivery retried",
      resource: `Outbox #${messageId}`,
      metadata: {
        outboxId: messageId,
        delivered: result.delivered,
        queued: result.queued,
        provider: result.provider ?? null,
        reason: result.reason ?? null,
      },
    });
    return Response.json({ result });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Email delivery retry failed.",
    }, { status: 409 });
  }
}
