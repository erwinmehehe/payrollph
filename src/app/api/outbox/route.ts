import {
  assertOrganizationRole,
  ORG_ADMIN_ROLES,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  activeMailProvider,
  deliveryCapable,
  getOutboxMessage,
  recentOutboxWithAttempts,
  retryOutboxMessage,
} from "@/lib/mailer";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
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

  const rows = await recentOutboxWithAttempts(50, organizationId);
  const summary = rows.reduce(
    (counts, row) => {
      if (row.status === "sent") counts.sent += 1;
      else if (row.status === "failed") counts.failed += 1;
      else if (row.status === "queued") counts.queued += 1;
      else if (row.status === "pending") counts.pending += 1;
      if (row.retryCount > 0) counts.retried += 1;
      return counts;
    },
    { queued: 0, pending: 0, sent: 0, failed: 0, retried: 0 },
  );

  return Response.json({
    provider: activeMailProvider(),
    deliveryCapable: deliveryCapable(),
    summary,
    messages: rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject,
      purpose: row.purpose,
      status: row.status,
      stateLabel: row.stateLabel,
      provider: row.provider,
      error: row.error,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
      retryCount: row.retryCount,
      attemptCount: row.attemptCount,
      canRetry: row.canRetry,
      lastAttemptAt: row.lastAttemptAt,
      providerMessageId: row.providerMessageId,
      runId: row.runId,
      employeeId: row.employeeId,
      periodLabel: row.periodLabel,
    })),
    note: "Messages stay queued while no provider is configured. Payslip-ready notices use bounded automatic retries; one-time-link messages must be regenerated after a failed attempt.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Outbox retry");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const messageId = Number(body.messageId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(messageId)) {
    return Response.json({ error: "organizationId and messageId are required." }, { status: 400 });
  }

  const row = await getOutboxMessage(messageId, organizationId);
  if (!row) return Response.json({ error: "Outbox message not found." }, { status: 404 });

  const allowedRoles = row.purpose === "payslip-ready" ? PAYROLL_OPERATOR_ROLES : ORG_ADMIN_ROLES;
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    allowedRoles,
    row.purpose === "payslip-ready"
      ? "Only payroll operators can retry payslip-ready notices."
      : "Only workspace administrators can retry this message.",
  );
  if (denied) return denied;

  if (row.purpose !== "payslip-ready") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
  }

  const result = await retryOutboxMessage({
    id: messageId,
    organizationId,
    actor: user.name,
    trigger: "manual",
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        queued: "queued" in result ? result.queued : false,
      },
      { status: result.status },
    );
  }

  return Response.json({
    retried: true,
    alreadySent: "alreadySent" in result ? result.alreadySent : false,
    id: messageId,
    status: result.status,
    provider: result.provider,
  });
}
