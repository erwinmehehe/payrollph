import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  organizations,
  performanceActionItemReminderEvents,
  performanceActionItemReminderTasks,
  performanceActionReminderPolicies,
  performanceOneOnOneActionItems,
  performanceOneOnOnes,
  userOrganizations,
  users,
} from "@/db/schema";
import { PEOPLE_ADMIN_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { philippineBusinessDate } from "@/lib/hcm-employment-terms";
import { queueMessage } from "@/lib/mailer";

export type PerformanceActionReminderPolicySnapshot = {
  version: number;
  enabled: boolean;
  reminderDaysBefore: number;
  escalationDaysOverdue: number;
  notifyManagerOnEmployeeItem: boolean;
  notifyPeopleAdminOnEscalation: boolean;
};

type ReminderTask = typeof performanceActionItemReminderTasks.$inferSelect;

type Recipient = {
  userId: number;
  name: string;
  email: string;
  role: "owner" | "manager" | "people_admin";
};

type ReminderSignal = {
  organizationId: number;
  actionItemId: number;
  oneOnOneId: number;
  employeeId: number;
  employeeName: string;
  actionTitle: string;
  ownerKind: string;
  ownerUserId: number | null;
  ownerEmployeeId: number | null;
  ownerName: string;
  managerUserId: number | null;
  managerName: string | null;
  sourceKey: string;
  stage: "upcoming" | "due" | "overdue" | "overdue_escalated";
  dueDate: string;
  recipients: Recipient[];
};

export const DEFAULT_PERFORMANCE_ACTION_REMINDER_POLICY: PerformanceActionReminderPolicySnapshot = {
  version: 0,
  enabled: true,
  reminderDaysBefore: 3,
  escalationDaysOverdue: 3,
  notifyManagerOnEmployeeItem: true,
  notifyPeopleAdminOnEscalation: true,
};

function policySnapshot(
  row: typeof performanceActionReminderPolicies.$inferSelect | null | undefined,
): PerformanceActionReminderPolicySnapshot {
  if (!row) return DEFAULT_PERFORMANCE_ACTION_REMINDER_POLICY;
  return {
    version: row.version,
    enabled: row.enabled,
    reminderDaysBefore: row.reminderDaysBefore,
    escalationDaysOverdue: row.escalationDaysOverdue,
    notifyManagerOnEmployeeItem: row.notifyManagerOnEmployeeItem,
    notifyPeopleAdminOnEscalation: row.notifyPeopleAdminOnEscalation,
  };
}

export async function loadPerformanceActionReminderPolicy(organizationId: number) {
  const [row] = await db.select().from(performanceActionReminderPolicies).where(
    eq(performanceActionReminderPolicies.organizationId, organizationId),
  ).limit(1);
  return { row: row ?? null, snapshot: policySnapshot(row) };
}

function dayDifference(dueDate: string, today: string) {
  return Math.round(
    (Date.parse(dueDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000,
  );
}

export function performanceActionReminderStage(
  daysUntil: number,
  policy: PerformanceActionReminderPolicySnapshot,
) {
  if (!policy.enabled || daysUntil > policy.reminderDaysBefore) return null;
  if (daysUntil > 0) return "upcoming" as const;
  if (daysUntil === 0) return "due" as const;
  if (Math.abs(daysUntil) < policy.escalationDaysOverdue) return "overdue" as const;
  return "overdue_escalated" as const;
}

function subject(signal: ReminderSignal) {
  return signal.stage === "overdue_escalated"
    ? "[Performance] Escalated overdue 1:1 action: " + signal.actionTitle
    : signal.stage === "overdue"
      ? "[Performance] Overdue 1:1 action: " + signal.actionTitle
      : signal.stage === "due"
        ? "[Performance] 1:1 action due today: " + signal.actionTitle
        : "[Performance] Upcoming 1:1 action: " + signal.actionTitle;
}

function body(signal: ReminderSignal, recipient: Recipient) {
  const urgency = signal.stage === "overdue_escalated"
    ? "This commitment is overdue and has crossed the escalation threshold."
    : signal.stage === "overdue"
      ? "This commitment is overdue."
      : signal.stage === "due"
        ? "This commitment is due today."
        : "This commitment is approaching its due date.";

  const responsibility = recipient.role === "owner"
    ? "You are the current owner of this 1:1 action item."
    : recipient.role === "manager"
      ? "You are receiving this because you manage the related 1:1 and the employee owns this commitment."
      : "You are receiving this escalation as a company-wide People administrator.";

  return [
    "Hi " + recipient.name + ",",
    "",
    urgency,
    responsibility,
    "Action: " + signal.actionTitle,
    "Employee: " + signal.employeeName,
    "Owner: " + signal.ownerName,
    "Due date: " + signal.dueDate,
    "",
    "Update the action item in Performance once progress is made or the commitment is complete.",
    "This workflow tracks performance follow-through only and does not change compensation or payroll.",
  ].join("\n");
}

async function recordEvent(
  task: ReminderTask,
  eventType: string,
  actorName: string,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(performanceActionItemReminderEvents).values({
    organizationId: task.organizationId,
    taskId: task.id,
    actionItemId: task.actionItemId,
    eventType,
    actorName,
    metadata,
  });
}

async function signalsForOrganization(
  organizationId: number,
  policy: PerformanceActionReminderPolicySnapshot,
  now: Date,
): Promise<ReminderSignal[]> {
  if (!policy.enabled) return [];

  const today = philippineBusinessDate(now);
  const [items, meetings, staff, memberships] = await Promise.all([
    db.select().from(performanceOneOnOneActionItems)
      .where(eq(performanceOneOnOneActionItems.organizationId, organizationId)),
    db.select().from(performanceOneOnOnes)
      .where(eq(performanceOneOnOnes.organizationId, organizationId)),
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({
      userId: users.id,
      employeeId: users.employeeId,
      name: users.name,
      email: users.email,
      role: userOrganizations.role,
      orgUnitId: userOrganizations.orgUnitId,
      membershipActive: userOrganizations.active,
      userActive: users.active,
    })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(eq(userOrganizations.organizationId, organizationId)),
  ]);

  const activeMemberships = memberships.filter((row) => row.membershipActive && row.userActive);
  const byUserId = new Map(activeMemberships.map((row) => [row.userId, row]));
  const employeeAccountById = new Map(
    activeMemberships
      .filter((row) => row.employeeId != null)
      .map((row) => [row.employeeId!, row]),
  );
  const fallbackPeopleAdmin = activeMemberships.find((row) =>
    row.orgUnitId == null
    && row.role === "hr"
    && roleAllowed(row.role, PEOPLE_ADMIN_ROLES)
  ) ?? activeMemberships.find((row) =>
    row.orgUnitId == null
    && roleAllowed(row.role, PEOPLE_ADMIN_ROLES)
  ) ?? null;
  const meetingById = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  const employeeById = new Map(staff.map((employee) => [employee.id, employee]));

  const signals: ReminderSignal[] = [];
  for (const item of items) {
    if (item.status === "completed" || item.status === "cancelled") continue;
    const stage = performanceActionReminderStage(dayDifference(item.dueDate, today), policy);
    if (!stage) continue;

    const meeting = meetingById.get(item.oneOnOneId);
    const employee = employeeById.get(item.employeeId);
    if (!meeting || !employee) continue;

    const employeeName = employee.firstName + " " + employee.lastName;
    const ownerMembership = item.ownerKind === "employee"
      ? item.ownerEmployeeId != null
        ? employeeAccountById.get(item.ownerEmployeeId) ?? null
        : null
      : item.ownerUserId != null
        ? byUserId.get(item.ownerUserId) ?? null
        : null;
    const managerMembership = byUserId.get(meeting.managerUserId) ?? null;

    const recipientMap = new Map<number, Recipient>();
    if (ownerMembership?.email) {
      recipientMap.set(ownerMembership.userId, {
        userId: ownerMembership.userId,
        name: ownerMembership.name,
        email: ownerMembership.email,
        role: "owner",
      });
    }
    if (
      item.ownerKind === "employee"
      && policy.notifyManagerOnEmployeeItem
      && managerMembership?.email
    ) {
      recipientMap.set(managerMembership.userId, {
        userId: managerMembership.userId,
        name: managerMembership.name,
        email: managerMembership.email,
        role: "manager",
      });
    }
    if (
      stage === "overdue_escalated"
      && policy.notifyPeopleAdminOnEscalation
      && fallbackPeopleAdmin?.email
    ) {
      recipientMap.set(fallbackPeopleAdmin.userId, {
        userId: fallbackPeopleAdmin.userId,
        name: fallbackPeopleAdmin.name,
        email: fallbackPeopleAdmin.email,
        role: "people_admin",
      });
    }

    if (recipientMap.size === 0 && fallbackPeopleAdmin?.email) {
      recipientMap.set(fallbackPeopleAdmin.userId, {
        userId: fallbackPeopleAdmin.userId,
        name: fallbackPeopleAdmin.name,
        email: fallbackPeopleAdmin.email,
        role: "people_admin",
      });
    }

    signals.push({
      organizationId,
      actionItemId: item.id,
      oneOnOneId: item.oneOnOneId,
      employeeId: item.employeeId,
      employeeName,
      actionTitle: item.title,
      ownerKind: item.ownerKind,
      ownerUserId: ownerMembership?.userId ?? item.ownerUserId,
      ownerEmployeeId: item.ownerEmployeeId,
      ownerName: item.ownerName,
      managerUserId: managerMembership?.userId ?? meeting.managerUserId,
      managerName: managerMembership?.name ?? null,
      sourceKey: "one-on-one-action:" + item.id,
      stage,
      dueDate: item.dueDate,
      recipients: [...recipientMap.values()],
    });
  }

  return signals;
}

async function syncOrganizationActionReminders(
  organizationId: number,
  actor: string,
  now: Date,
) {
  const policyState = await loadPerformanceActionReminderPolicy(organizationId);
  const policy = policyState.snapshot;
  const signals = await signalsForOrganization(organizationId, policy, now);
  const existing = await db.select().from(performanceActionItemReminderTasks)
    .where(eq(performanceActionItemReminderTasks.organizationId, organizationId));
  const existingByKey = new Map(existing.map((task) => [task.sourceKey, task]));
  const activeKeys = new Set(signals.map((signal) => signal.sourceKey));
  const results: Array<{ taskId: number; actionItemId: number; action: string; stage: string; notified: number }> = [];

  for (const task of existing) {
    if (task.status === "open" && !activeKeys.has(task.sourceKey)) {
      const [resolved] = await db.update(performanceActionItemReminderTasks).set({
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(performanceActionItemReminderTasks.id, task.id)).returning();
      await recordEvent(resolved, "resolved", actor, { reason: "action_completed_cancelled_or_not_due" });
      await recordAuditEvent({
        organizationId,
        actor,
        action: "Performance action reminder resolved",
        resource: "1:1 action #" + task.actionItemId,
        metadata: { reminderTaskId: task.id, actionItemId: task.actionItemId },
      });
      results.push({ taskId: task.id, actionItemId: task.actionItemId, action: "resolved", stage: task.stage, notified: 0 });
    }
  }

  for (const signal of signals) {
    const current = existingByKey.get(signal.sourceKey);
    let task: ReminderTask;
    let action = "unchanged";

    if (!current) {
      [task] = await db.insert(performanceActionItemReminderTasks).values({
        organizationId,
        actionItemId: signal.actionItemId,
        oneOnOneId: signal.oneOnOneId,
        employeeId: signal.employeeId,
        sourceKey: signal.sourceKey,
        stage: signal.stage,
        dueDate: signal.dueDate,
        status: "open",
        ownerUserId: signal.ownerUserId,
        ownerEmployeeId: signal.ownerEmployeeId,
        ownerName: signal.ownerName,
        managerUserId: signal.managerUserId,
        managerName: signal.managerName,
        escalatedToUserId: signal.stage === "overdue_escalated"
          ? signal.recipients.find((recipient) => recipient.role === "people_admin")?.userId ?? null
          : null,
        escalatedToName: signal.stage === "overdue_escalated"
          ? signal.recipients.find((recipient) => recipient.role === "people_admin")?.name ?? null
          : null,
      }).returning();
      action = "created";
      await recordEvent(task, "created", actor, { stage: signal.stage, policyVersion: policy.version });
    } else if (
      current.stage !== signal.stage
      || current.status !== "open"
      || current.ownerUserId !== signal.ownerUserId
      || current.ownerEmployeeId !== signal.ownerEmployeeId
      || current.dueDate !== signal.dueDate
    ) {
      const episodeChanged =
        current.stage !== signal.stage
        || current.ownerUserId !== signal.ownerUserId
        || current.ownerEmployeeId !== signal.ownerEmployeeId
        || current.dueDate !== signal.dueDate;
      const peopleAdmin = signal.recipients.find((recipient) => recipient.role === "people_admin") ?? null;
      [task] = await db.update(performanceActionItemReminderTasks).set({
        stage: signal.stage,
        dueDate: signal.dueDate,
        status: "open",
        ownerUserId: signal.ownerUserId,
        ownerEmployeeId: signal.ownerEmployeeId,
        ownerName: signal.ownerName,
        managerUserId: signal.managerUserId,
        managerName: signal.managerName,
        escalatedToUserId: signal.stage === "overdue_escalated" ? peopleAdmin?.userId ?? null : null,
        escalatedToName: signal.stage === "overdue_escalated" ? peopleAdmin?.name ?? null : null,
        notificationEpisode: episodeChanged ? current.notificationEpisode + 1 : current.notificationEpisode,
        resolvedAt: null,
        updatedAt: now,
      }).where(eq(performanceActionItemReminderTasks.id, current.id)).returning();
      action = episodeChanged ? "advanced" : "updated";
      await recordEvent(task, action, actor, {
        previousStage: current.stage,
        stage: signal.stage,
        policyVersion: policy.version,
      });
    } else {
      task = current;
    }

    let notified = 0;
    for (const recipient of signal.recipients) {
      const delivery = await queueMessage({
        organizationId,
        recipient: recipient.email,
        subject: subject(signal).slice(0, 180),
        body: body(signal, recipient),
        purpose: "hcm-performance-action-reminder",
        dedupeKey: [
          "performance-action-reminder",
          task.id,
          signal.stage,
          "episode-" + task.notificationEpisode,
          "user-" + recipient.userId,
          recipient.role,
        ].join(":").slice(0, 200),
        metadata: {
          reminderTaskId: task.id,
          actionItemId: task.actionItemId,
          oneOnOneId: task.oneOnOneId,
          stage: signal.stage,
          recipientUserId: recipient.userId,
          recipientRole: recipient.role,
          policyVersion: policy.version,
        },
        audit: {
          actor,
          metadata: {
            reminderTaskId: task.id,
            actionItemId: task.actionItemId,
            stage: signal.stage,
            recipientUserId: recipient.userId,
            recipientRole: recipient.role,
          },
        },
      });
      if (!("deduplicated" in delivery && delivery.deduplicated)) {
        notified += 1;
        await recordEvent(
          task,
          signal.stage === "overdue_escalated" && recipient.role === "people_admin"
            ? "escalated"
            : "notified",
          actor,
          {
            stage: signal.stage,
            recipientUserId: recipient.userId,
            recipientRole: recipient.role,
            outboxId: delivery.id,
          },
        );
      }
    }

    if (notified > 0) {
      await db.update(performanceActionItemReminderTasks).set({
        lastNotifiedAt: now,
        updatedAt: now,
      }).where(eq(performanceActionItemReminderTasks.id, task.id));
    }

    results.push({
      taskId: task.id,
      actionItemId: task.actionItemId,
      action,
      stage: signal.stage,
      notified,
    });
  }

  return { policy, results };
}

export async function runScheduledPerformanceActionReminders(input: {
  actor: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  const results = [];
  for (const organization of orgs) {
    const organizationResult = await syncOrganizationActionReminders(
      organization.id,
      input.actor,
      now,
    );
    if (organizationResult.results.length) {
      results.push({ organizationId: organization.id, ...organizationResult });
    }
  }
  return results;
}
