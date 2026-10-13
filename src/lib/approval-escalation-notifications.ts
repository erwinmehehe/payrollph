import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalChainInstances, approvalTasks, userOrganizations, users } from "@/db/schema";
import { roleApproverMatchesRole } from "@/lib/delegation";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
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

/** Revalidate queued delivery after feature rollback, membership revocation or
 * approval completion. Existing outbox mail must never become a stale disclosure.
 */
export async function approvalEscalationRetryAllowed(input: {
  organizationId: number | null;
  recipient: string;
  metadata: unknown;
}): Promise<boolean> {
  if (!criticalReleaseFlagEnabled("approvalChainEscalations")) return false;
  if (!Number.isSafeInteger(input.organizationId) || (input.organizationId ?? 0) <= 0 ||
      typeof input.recipient !== "string" || !input.metadata ||
      typeof input.metadata !== "object" || Array.isArray(input.metadata)) return false;
  const data = input.metadata as Record<string, unknown>;
  const { instanceId, stepIndex, approvalTaskId, recipientUserId } = data;
  if (typeof instanceId !== "number" || !Number.isSafeInteger(instanceId) || instanceId <= 0 ||
      typeof stepIndex !== "number" || !Number.isSafeInteger(stepIndex) || stepIndex < 0 ||
      typeof approvalTaskId !== "number" || !Number.isSafeInteger(approvalTaskId) || approvalTaskId <= 0 ||
      typeof recipientUserId !== "number" || !Number.isSafeInteger(recipientUserId) || recipientUserId <= 0) return false;
  const [instance] = await db.select({
    status: approvalChainInstances.status,
    stepsSnapshot: approvalChainInstances.stepsSnapshot,
    currentStepIndex: approvalChainInstances.currentStepIndex,
  }).from(approvalChainInstances).where(and(
    eq(approvalChainInstances.id, instanceId),
    eq(approvalChainInstances.organizationId, input.organizationId!),
  )).limit(1);
  const [task] = await db.select({ status: approvalTasks.status }).from(approvalTasks).where(and(
    eq(approvalTasks.id, approvalTaskId),
    eq(approvalTasks.organizationId, input.organizationId!),
    eq(approvalTasks.approvalChainInstanceId, instanceId),
    eq(approvalTasks.approvalChainStepIndex, stepIndex),
  )).limit(1);
  if (!instance || instance.status !== "pending" || instance.currentStepIndex !== stepIndex ||
      !task || task.status !== "Pending" || !Array.isArray(instance.stepsSnapshot)) return false;
  const step = instance.stepsSnapshot[stepIndex] as { escalationRecipient?: unknown } | undefined;
  if (typeof step?.escalationRecipient !== "string") return false;
  const recipients = await resolveApprovalEscalationRecipients(input.organizationId!, step.escalationRecipient);
  return recipients.some(row => row.id === recipientUserId &&
    row.email.toLowerCase() === input.recipient.toLowerCase());
}
