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

export type EscalationStage = 0 | 1 | 2 | 3;

export function escalationStage(
  task: Pick<ComplianceTask, "status" | "severity" | "firstDetectedAt">,
  now = new Date(),
): EscalationStage {
  if (task.status === "resolved" || task.severity === "info") return 0;
  const ageMs = Math.max(0, now.getTime() - new Date(task.firstDetectedAt).getTime());
  if (ageMs >= 72 * 60 * 60 * 1000) return 3;
  if (ageMs >= 24 * 60 * 60 * 1000) return 2;
  return 1;
}

export function escalationDedupeKey(input: {
  organizationId: number;
  taskId: number;
  episode: number;
  severity: string;
  stage: EscalationStage;
  recipientUserId: number;
}) {
  return [
    "statutory-remittance",
    input.organizationId,
    input.taskId,
    `episode-${input.episode}`,
    input.severity,
    `stage-${input.stage}`,
    `user-${input.recipientUserId}`,
  ].join(":").slice(0, 200);
}

export function escalationSubject(task: ComplianceTask, stage: EscalationStage) {
  const prefix =
    stage >= 3
      ? task.severity === "danger"
        ? "[Executive critical payroll compliance]"
        : "[Executive payroll compliance escalation]"
      : stage === 2
        ? task.severity === "danger"
          ? "[Critical payroll compliance follow-up]"
          : "[Payroll compliance follow-up]"
        : task.severity === "danger"
          ? "[Critical payroll compliance]"
          : "[Payroll compliance]";
  return `${prefix} ${task.title}`.slice(0, 180);
}

export function escalationBody(
  task: ComplianceTask,
  recipientName: string,
  stage: EscalationStage,
  now = new Date(),
) {
  const ownership = task.assignedToName
    ? `Assigned to: ${task.assignedToName}`
    : "Assigned to: nobody yet";
  const due = task.dueDate ? `Due date: ${task.dueDate}` : "Due date: unavailable";
  const status = task.status === "in_progress" ? "In progress" : "Open";
  const ageHours = Math.max(
    0,
    Math.floor((now.getTime() - new Date(task.firstDetectedAt).getTime()) / (60 * 60 * 1000)),
  );
  const escalation = stage >= 3
    ? "Escalation stage: executive escalation (unresolved for at least 72 hours)"
    : stage === 2
      ? "Escalation stage: 24-hour follow-up"
      : "Escalation stage: initial alert";

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
    `Open for: ${ageHours} hour${ageHours === 1 ? "" : "s"}`,
    escalation,
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
  stage: EscalationStage = 1,
) {
  if (task.status === "resolved" || task.severity === "info") return [];

  const byUserId = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
  const selected = new Map<number, Recipient>();

  if (task.assignedToUserId != null) {
    const assigned = byUserId.get(task.assignedToUserId);
    if (assigned) selected.set(assigned.userId, assigned);
  }

  const ownerAdmins = recipients.filter((recipient) => isOwnerAdmin(recipient.role));

  if (task.severity === "danger" || stage >= 2 || selected.size === 0) {
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
    stage: EscalationStage;
  }> = [];

  const now = new Date();

  for (const task of tasks) {
    const stage = escalationStage(task, now);
    if (stage === 0) continue;
    const selected = chooseEscalationRecipients(task, recipients, stage);
    for (const recipient of selected) {
      const result = await queueMessage({
        organizationId: input.organizationId,
        recipient: recipient.email,
        subject: escalationSubject(task, stage),
        body: escalationBody(task, recipient.name, stage, now),
        purpose: "statutory-remittance-escalation",
        dedupeKey: escalationDedupeKey({
          organizationId: input.organizationId,
          taskId: task.id,
          episode: task.escalationEpisode,
          severity: task.severity,
          stage,
          recipientUserId: recipient.userId,
        }),
        metadata: {
          taskId: task.id,
          sourceKey: task.sourceKey,
          episode: task.escalationEpisode,
          severity: task.severity,
          stage,
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
            stage,
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
        stage,
      });
    }
  }

  return results;
}
