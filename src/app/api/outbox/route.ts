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
    ORG_ADMIN_ROLES,
    "Only workspace administrators can view the email delivery dashboard.",
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
      if (row.deliveryStatus === "delivered") counts.delivered += 1;
      if (["bounced", "complained", "failed", "suppressed"].includes(row.deliveryStatus ?? "")) {
        counts.deliveryIssues += 1;
      }
      return counts;
    },
    { queued: 0, pending: 0, sent: 0, failed: 0, retried: 0, delivered: 0, deliveryIssues: 0 },
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
      maxAttempts: row.maxAttempts,
      canRetry: row.canRetry,
      lastAttemptAt: row.lastAttemptAt,
      nextAttemptAt: row.nextAttemptAt,
      providerMessageId: row.providerMessageId,
      deliveryStatus: row.deliveryStatus,
      deliveryEventAt: row.deliveryEventAt,
      deliveryDetail: row.deliveryDetail,
      runId: row.runId,
      employeeId: row.employeeId,
      periodLabel: row.periodLabel,
    })),
    note: "Outbox state tracks send attempts. Verified provider webhooks add delivered, delayed, bounced, complained, failed, or suppressed delivery outcomes when available.",
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
      { status: result.httpStatus },
    );
  }

  return Response.json({
    retried: true,
    alreadySent: "alreadySent" in result ? result.alreadySent : false,
    id: messageId,
    status: "deliveryStatus" in result ? result.deliveryStatus : "sent",
    provider: result.provider,
  });
}
