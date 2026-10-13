import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { userOrganizations, users } from "@/db/schema";
import { roleApproverMatchesRole } from "@/lib/delegation";
import { queueMessage } from "@/lib/mailer";

/**
 * Escalation recipients see only an advisory: they are never substituted for
 * the configured checker, delegate, or payroll releaser. No pay, name, amount
 * or employee data is included in outgoing notices.
 */
export type EscalationRecipient = {
  id: number;
  email: string;
  name: string;
  role: string;
  orgUnitId: number | null;
};
export function eligibleEscalationRecipient(row: EscalationRecipient, target: string): boolean {
  if (row.orgUnitId !== null || !Number.isSafeInteger(row.id) || row.id <= 0 ||
      !row.email.trim() || !["owner", "admin", "hr", "bookkeeper", "manager"].includes(row.role)) {
    return false;
  }
  if (target.startsWith("user:")) {
    return String(row.id) === target.slice(5);
  }
  return roleApproverMatchesRole(target, row.role);
}

export async function resolveApprovalEscalationRecipients(
  organizationId: number, target: string | undefined,
): Promise<EscalationRecipient[]> {
  if (!target || !/^(?:role:(?:hr|finance|owner|manager)|user:[1-9][0-9]{0,9})$/.test(target)) {
    return [];
  }
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return [];
  const rows = await db.select({
    id: users.id, email: users.email, name: users.name,
    role: userOrganizations.role, orgUnitId: userOrganizations.orgUnitId,
  }).from(userOrganizations).innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(and(
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true), eq(users.active, true),
    ));
  return rows.filter(row => eligibleEscalationRecipient(row, target));
}

/**
 * Durable, idempotent outbox; failed/unconfigured providers remain queued or
 * failed and are NEVER called delivered. A later scheduler tick can retry the
 * same dedupe key without sending an extra notice to the same recipient.
 */
export async function queueApprovalEscalationNotices(input: {
  organizationId: number; instanceId: number; stepIndex: number; taskId: number;
  recipientTarget: string;
  recipients: readonly EscalationRecipient[];
}) {
  let queuedOrSent = 0;
  for (const recipient of input.recipients) {
    // Revalidate the current employer-scoped membership before every send.
    const active = await resolveApprovalEscalationRecipients(input.organizationId, input.recipientTarget);
    if (!active.some(row => row.id === recipient.id)) continue;
    const result = await queueMessage({
      organizationId: input.organizationId,
      recipient: recipient.email,
      subject: "PayrollPH approval needs attention",
      body: [
        "An approval step is overdue and requires human attention.",
        "Sign in to PayrollPH and review the Approvals workspace.",
        "This reminder does not transfer authority or approve or release payroll.",
      ].join("\n"),
      purpose: "approval-chain-escalation",
      dedupeKey: [
        "approval-escalation", input.organizationId, input.instanceId,
        input.stepIndex, recipient.id,
      ].join(":"),
      metadata: { instanceId: input.instanceId, stepIndex: input.stepIndex,
        approvalTaskId: input.taskId, recipientUserId: recipient.id },
      audit: { actor: "System scheduler",
        metadata: { instanceId: input.instanceId, stepIndex: input.stepIndex,
          taskId: input.taskId, recipientUserId: recipient.id } },
    });
    if (["queued", "pending", "sent"].includes(result.status)) queuedOrSent++;
  }
  return { queuedOrSent };
}
