import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  userOrganizations,
  users,
} from "@/db/schema";
import { PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { queueMessage } from "@/lib/mailer";

type ComplianceTask = typeof complianceActionTasks.$inferSelect;

type Recipient = {
  userId: number;
  name: string;
  email: string;
  role: string;
};

function isOwnerAdmin(role: string) {
  return role === "owner" || role === "admin";
}

export function escalationDedupeKey(input: {
  organizationId: number;
  taskId: number;
  episode: number;
  severity: string;
  recipientUserId: number;
}) {
  return [
    "statutory-remittance",
    input.organizationId,
    input.taskId,
    `episode-${input.episode}`,
    input.severity,
    `user-${input.recipientUserId}`,
  ].join(":").slice(0, 200);
}

export function escalationSubject(task: ComplianceTask) {
  const prefix = task.severity === "danger"
    ? "[Critical payroll compliance]"
    : "[Payroll compliance]";
  return `${prefix} ${task.title}`.slice(0, 180);
}

export function escalationBody(task: ComplianceTask, recipientName: string) {
  const ownership = task.assignedToName
    ? `Assigned to: ${task.assignedToName}`
    : "Assigned to: nobody yet";
  const due = task.dueDate ? `Due date: ${task.dueDate}` : "Due date: unavailable";
  const status = task.status === "in_progress" ? "In progress" : "Open";

  return [
    `Hi ${recipientName},`,
    "",
    "PayrollPH detected a statutory remittance compliance action that needs attention.",
    "",
    `${task.title}`,
    task.detail,
    "",
    `Agency: ${task.agency ?? "Statutory remittance"}`,
    `Applicable month: ${task.applicableMonth ?? "Not specified"}`,
    due,
    ownership,
    `Status: ${status}`,
    "",
    "Open Payroll > Statutory Remittance Control to resolve the underlying payment or employee-posting issue.",
    "",
    "This alert cannot be cleared by dismissing the email. The compliance action resolves only when the underlying evidence is corrected.",
  ].join("\n");
}

async function organizationRecipients(organizationId: number) {
  const rows = await db.select({
    userId: userOrganizations.userId,
    role: userOrganizations.role,
    orgUnitId: userOrganizations.orgUnitId,
    name: users.name,
    email: users.email,
  })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(eq(userOrganizations.organizationId, organizationId));

  return rows
    .filter((row) =>
      row.orgUnitId == null
      && roleAllowed(row.role, PAYROLL_OPERATOR_ROLES),
    )
    .map((row) => ({
      userId: row.userId,
      role: row.role,
      name: row.name,
      email: row.email,
    }));
}

export function chooseEscalationRecipients(
  task: ComplianceTask,
  recipients: Recipient[],
) {
  if (task.status === "resolved" || task.severity === "info") return [];

  const byUserId = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
  const selected = new Map<number, Recipient>();

  if (task.assignedToUserId != null) {
    const assigned = byUserId.get(task.assignedToUserId);
    if (assigned) selected.set(assigned.userId, assigned);
  }

  const ownerAdmins = recipients.filter((recipient) => isOwnerAdmin(recipient.role));

  if (task.severity === "danger" || selected.size === 0) {
    for (const recipient of ownerAdmins) selected.set(recipient.userId, recipient);
  }

  if (selected.size === 0) {
    for (const recipient of recipients) selected.set(recipient.userId, recipient);
  }

  return [...selected.values()];
}

export async function queueStatutoryComplianceEscalations(input: {
  organizationId: number;
  taskIds?: number[];
  actor: string;
}) {
  let tasks = await db.select().from(complianceActionTasks).where(and(
    eq(complianceActionTasks.organizationId, input.organizationId),
    eq(complianceActionTasks.sourceType, "statutory_remittance"),
  ));

  if (input.taskIds?.length) {
    const allowed = new Set(input.taskIds);
    tasks = tasks.filter((task) => allowed.has(task.id));
  }

  const recipients = await organizationRecipients(input.organizationId);
  const results: Array<{
    taskId: number;
    recipientUserId: number;
    queued: boolean;
    delivered: boolean;
    deduplicated: boolean;
  }> = [];

  for (const task of tasks) {
    const selected = chooseEscalationRecipients(task, recipients);
    for (const recipient of selected) {
      const result = await queueMessage({
        organizationId: input.organizationId,
        recipient: recipient.email,
        subject: escalationSubject(task),
        body: escalationBody(task, recipient.name),
        purpose: "statutory-remittance-escalation",
        dedupeKey: escalationDedupeKey({
          organizationId: input.organizationId,
          taskId: task.id,
          episode: task.escalationEpisode,
          severity: task.severity,
          recipientUserId: recipient.userId,
        }),
        metadata: {
          taskId: task.id,
          sourceKey: task.sourceKey,
          episode: task.escalationEpisode,
          severity: task.severity,
          recipientUserId: recipient.userId,
          assignedToUserId: task.assignedToUserId,
          agency: task.agency,
          applicableMonth: task.applicableMonth,
          dueDate: task.dueDate,
        },
        audit: {
          actor: input.actor,
          metadata: {
            complianceActionId: task.id,
            sourceKey: task.sourceKey,
            episode: task.escalationEpisode,
            severity: task.severity,
            recipientUserId: recipient.userId,
          },
        },
      });

      results.push({
        taskId: task.id,
        recipientUserId: recipient.userId,
        queued: result.queued,
        delivered: result.delivered,
        deduplicated: "deduplicated" in result && result.deduplicated === true,
      });
    }
  }

  return results;
}
