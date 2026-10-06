import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  hcmLifecycleNotificationEvents,
  hcmLifecycleNotificationTasks,
  positionAssignments,
  positions,
  userOrganizations,
  users,
} from "@/db/schema";
import { PEOPLE_ADMIN_ROLES, roleAllowed, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { loadEmploymentLifecycleReadiness } from "@/lib/hcm-lifecycle-readiness-server";
import { philippineBusinessDate } from "@/lib/hcm-employment-terms";
import { queueMessage } from "@/lib/mailer";

type LifecycleRow = Awaited<ReturnType<typeof loadEmploymentLifecycleReadiness>>["rows"][number];
type LifecycleTask = typeof hcmLifecycleNotificationTasks.$inferSelect;

type OwnerCandidate = {
  userId: number;
  employeeId: number | null;
  name: string;
  email: string;
  role: string;
  orgUnitId: number | null;
};

export type LifecycleSignal = {
  sourceType: "employment_terms" | "employment_decision" | "separation_handoff";
  sourceId: number | null;
  sourceKey: string;
  action: string;
  stage: string;
  escalationStage: number;
  severity: "info" | "warning" | "blocker";
  title: string;
  detail: string;
  dueDate: string | null;
};

function milestoneForDays(daysUntil: number | null) {
  if (daysUntil == null) return { stage: "unscheduled", escalationStage: 0, severity: "info" as const };
  if (daysUntil > 14) return { stage: "t30", escalationStage: 0, severity: "info" as const };
  if (daysUntil > 7) return { stage: "t14", escalationStage: 0, severity: "info" as const };
  if (daysUntil > 1) return { stage: "t7", escalationStage: 0, severity: "warning" as const };
  if (daysUntil === 1) return { stage: "t1", escalationStage: 1, severity: "warning" as const };
  if (daysUntil === 0) return { stage: "due", escalationStage: 1, severity: "blocker" as const };
  if (daysUntil >= -4) return { stage: "overdue", escalationStage: 2, severity: "blocker" as const };
  return { stage: "overdue_escalated", escalationStage: 3, severity: "blocker" as const };
}

export function lifecycleSignalForRow(row: LifecycleRow): LifecycleSignal | null {
  if (row.action === "none" || row.action === "await_effective_date") return null;

  if (row.action === "configure_terms") {
    return {
      sourceType: "employment_terms",
      sourceId: null,
      sourceKey: `employee:${row.employeeId}:employment-terms-unconfigured`,
      action: row.action,
      stage: "unconfigured",
      escalationStage: 1,
      severity: "warning",
      title: `${row.employeeName}: employment terms are not governed`,
      detail: row.detail,
      dueDate: null,
    };
  }

  if (row.action === "record_decision" && row.term) {
    const milestone = milestoneForDays(row.daysUntil);
    return {
      sourceType: "employment_terms",
      sourceId: row.term.id,
      sourceKey: `term:${row.term.id}:decision-required`,
      action: row.action,
      ...milestone,
      title: row.label,
      detail: row.detail,
      dueDate: row.dueDate,
    };
  }

  if ((row.action === "review_decision" || row.action === "retry_decision") && row.decision) {
    const overdueDays = row.daysUntil == null ? null : -row.daysUntil;
    const escalationStage = row.action === "retry_decision"
      ? 2
      : overdueDays != null && overdueDays >= 5
        ? 3
        : overdueDays != null && overdueDays > 0
          ? 2
          : 1;
    return {
      sourceType: "employment_decision",
      sourceId: row.decision.id,
      sourceKey: `decision:${row.decision.id}:${row.action === "retry_decision" ? "failed" : "approval"}`,
      action: row.action,
      stage: row.action === "retry_decision"
        ? "failed"
        : escalationStage >= 3
          ? "approval_overdue_escalated"
          : escalationStage === 2
            ? "approval_overdue"
            : "approval_pending",
      escalationStage,
      severity: escalationStage >= 2 ? "blocker" : "warning",
      title: row.label,
      detail: row.detail,
      dueDate: row.dueDate,
    };
  }

  if ((row.action === "start_separation" || row.action === "continue_separation") && row.decision) {
    const milestone = milestoneForDays(row.daysUntil);
    const started = row.action === "continue_separation";
    return {
      sourceType: "separation_handoff",
      sourceId: row.decision.id,
      sourceKey: `decision:${row.decision.id}:${started ? "separation-started" : "separation-ready"}`,
      action: row.action,
      stage: started
        ? milestone.escalationStage >= 3
          ? "handoff_started_overdue_escalated"
          : milestone.escalationStage >= 2
            ? "handoff_started_overdue"
            : "handoff_started"
        : milestone.escalationStage >= 3
          ? "handoff_ready_overdue_escalated"
          : milestone.escalationStage >= 2
            ? "handoff_ready_overdue"
            : "handoff_ready",
      escalationStage: Math.max(started ? 0 : 1, milestone.escalationStage),
      severity: milestone.escalationStage >= 2 ? "blocker" : "warning",
      title: row.label,
      detail: row.detail,
      dueDate: row.dueDate,
    };
  }

  return null;
}

export async function listLifecycleOwnerCandidates(organizationId: number): Promise<OwnerCandidate[]> {
  const rows = await db.select({
    userId: users.id,
    employeeId: users.employeeId,
    name: users.name,
    email: users.email,
    role: userOrganizations.role,
    orgUnitId: userOrganizations.orgUnitId,
  })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(and(
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
      eq(users.active, true),
    ));

  return rows.filter((row) =>
    roleAllowed(row.role, PEOPLE_ADMIN_ROLES)
    || roleAllowed(row.role, WORKFORCE_MANAGER_ROLES),
  );
}

async function defaultLifecycleOwner(
  organizationId: number,
  employeeId: number,
  candidates: OwnerCandidate[],
) {
  const [assignment] = await db.select({
    managerEmployeeId: positions.managerEmployeeId,
  })
    .from(positionAssignments)
    .innerJoin(positions, eq(positionAssignments.positionId, positions.id))
    .where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.employeeId, employeeId),
      eq(positionAssignments.assignmentType, "primary"),
    ))
    .orderBy(positionAssignments.effectiveFrom)
    .limit(1);

  if (assignment?.managerEmployeeId) {
    const manager = candidates.find((candidate) =>
      candidate.employeeId === assignment.managerEmployeeId
      && candidate.role === "manager",
    );
    if (manager) return manager;
  }

  return candidates.find((candidate) =>
    candidate.orgUnitId == null && candidate.role === "hr",
  ) ?? candidates.find((candidate) =>
    candidate.orgUnitId == null && ["owner", "admin", "bookkeeper"].includes(candidate.role),
  ) ?? null;
}

function notificationBody(task: LifecycleTask, recipientName: string) {
  const escalation = task.escalationStage >= 3
    ? "Escalation: this lifecycle item has remained unresolved past the escalation threshold."
    : task.escalationStage === 2
      ? "Escalation: this lifecycle item is overdue."
      : task.escalationStage === 1
        ? "Action is due or requires prompt review."
        : "This is an upcoming employment lifecycle reminder.";

  return [
    `Hi ${recipientName},`,
    "",
    task.title,
    "",
    task.detail,
    task.dueDate ? `Lifecycle date: ${task.dueDate}` : "Lifecycle date: not configured",
    `Stage: ${task.stage.replaceAll("_", " ")}`,
    escalation,
    "",
    "Open People > Lifecycle action center in PayrollPH to review the governed employment terms or decision.",
    "",
    "PayrollPH does not automatically regularize, renew, convert, or separate a worker because a date was reached.",
  ].join("\n");
}

async function recipientsForTask(
  task: LifecycleTask,
  candidates: OwnerCandidate[],
) {
  const selected = new Map<number, OwnerCandidate>();
  if (task.ownerUserId) {
    const owner = candidates.find((candidate) => candidate.userId === task.ownerUserId);
    if (owner) selected.set(owner.userId, owner);
  }

  if (!task.ownerUserId || task.escalationStage >= 2) {
    for (const candidate of candidates) {
      if (
        candidate.orgUnitId == null
        && roleAllowed(candidate.role, PEOPLE_ADMIN_ROLES)
      ) {
        selected.set(candidate.userId, candidate);
      }
    }
  }

  return [...selected.values()];
}

async function recordLifecycleNotificationEvent(input: {
  task: LifecycleTask;
  eventType: string;
  actor: string;
  actorUserId?: number | null;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(hcmLifecycleNotificationEvents).values({
    organizationId: input.task.organizationId,
    taskId: input.task.id,
    employeeId: input.task.employeeId,
    eventType: input.eventType,
    actorUserId: input.actorUserId ?? null,
    actorName: input.actor,
    metadata: input.metadata ?? {},
  });
}

async function sendLifecycleTaskNotifications(
  task: LifecycleTask,
  candidates: OwnerCandidate[],
  actor: string,
) {
  if (task.status !== "open") return [];
  const recipients = await recipientsForTask(task, candidates);
  const results = [];

  for (const recipient of recipients) {
    const result = await queueMessage({
      organizationId: task.organizationId,
      recipient: recipient.email,
      subject: `[Employment lifecycle] ${task.title}`.slice(0, 180),
      body: notificationBody(task, recipient.name),
      purpose: "hcm-lifecycle-notification",
      dedupeKey: [
        "hcm-lifecycle",
        task.id,
        task.stage,
        `episode-${task.notificationEpisode}`,
        `user-${recipient.userId}`,
      ].join(":").slice(0, 200),
      metadata: {
        lifecycleTaskId: task.id,
        employeeId: task.employeeId,
        action: task.action,
        stage: task.stage,
        escalationStage: task.escalationStage,
        recipientUserId: recipient.userId,
      },
      audit: {
        actor,
        metadata: {
          lifecycleTaskId: task.id,
          employeeId: task.employeeId,
          stage: task.stage,
          escalationStage: task.escalationStage,
          recipientUserId: recipient.userId,
        },
      },
    });
    results.push(result);

    if (!("deduplicated" in result && result.deduplicated)) {
      await recordLifecycleNotificationEvent({
        task,
        eventType: task.escalationStage >= 2 ? "escalated" : "notified",
        actor,
        metadata: {
          recipientUserId: recipient.userId,
          recipientRole: recipient.role,
          stage: task.stage,
          escalationStage: task.escalationStage,
          outboxId: result.id,
        },
      });
    }
  }

  if (recipients.length > 0) {
    await db.update(hcmLifecycleNotificationTasks).set({
      lastNotifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(hcmLifecycleNotificationTasks.id, task.id));
  }

  return results;
}

async function syncOrganizationLifecycleTasks(
  organizationId: number,
  actor: string,
  now: Date,
) {
  const today = philippineBusinessDate(now);
  const readiness = await loadEmploymentLifecycleReadiness(organizationId, today);
  const candidates = await listLifecycleOwnerCandidates(organizationId);
  const existing = await db.select().from(hcmLifecycleNotificationTasks)
    .where(eq(hcmLifecycleNotificationTasks.organizationId, organizationId));
  const existingByKey = new Map(existing.map((task) => [task.sourceKey, task]));
  const detected = new Set<string>();
  const touched: LifecycleTask[] = [];

  for (const row of readiness.rows) {
    const signal = lifecycleSignalForRow(row);
    if (!signal) continue;
    detected.add(signal.sourceKey);

    const prior = existingByKey.get(signal.sourceKey) ?? null;
    const defaultOwner = prior?.ownerUserId
      ? null
      : await defaultLifecycleOwner(organizationId, row.employeeId, candidates);
    const stageChanged = Boolean(prior && prior.stage !== signal.stage);
    const escalationIncreased = Boolean(prior && signal.escalationStage > prior.escalationStage);
    const snoozeExpired = Boolean(
      prior?.status === "snoozed"
      && prior.snoozeUntil
      && prior.snoozeUntil.getTime() <= now.getTime(),
    );
    const reopen = Boolean(
      prior
      && (
        prior.status === "resolved"
        || stageChanged
        || escalationIncreased
        || snoozeExpired
      )
    );

    if (!prior) {
      const [created] = await db.insert(hcmLifecycleNotificationTasks).values({
        organizationId,
        employeeId: row.employeeId,
        sourceType: signal.sourceType,
        sourceId: signal.sourceId,
        sourceKey: signal.sourceKey,
        action: signal.action,
        stage: signal.stage,
        escalationStage: signal.escalationStage,
        severity: signal.severity,
        title: signal.title,
        detail: signal.detail,
        dueDate: signal.dueDate,
        status: "open",
        ownerUserId: defaultOwner?.userId ?? null,
        ownerName: defaultOwner?.name ?? null,
        firstDetectedAt: now,
        lastDetectedAt: now,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await recordLifecycleNotificationEvent({
        task: created,
        eventType: "detected",
        actor,
        metadata: {
          stage: created.stage,
          escalationStage: created.escalationStage,
          ownerUserId: created.ownerUserId,
        },
      });
      touched.push(created);
      continue;
    }

    const nextStatus = reopen ? "open" : prior.status;
    const nextEpisode = reopen ? prior.notificationEpisode + 1 : prior.notificationEpisode;
    const [updated] = await db.update(hcmLifecycleNotificationTasks).set({
      employeeId: row.employeeId,
      sourceType: signal.sourceType,
      sourceId: signal.sourceId,
      action: signal.action,
      stage: signal.stage,
      escalationStage: signal.escalationStage,
      severity: signal.severity,
      title: signal.title,
      detail: signal.detail,
      dueDate: signal.dueDate,
      status: nextStatus,
      ownerUserId: prior.ownerUserId ?? defaultOwner?.userId ?? null,
      ownerName: prior.ownerName ?? defaultOwner?.name ?? null,
      acknowledgedAt: reopen ? null : prior.acknowledgedAt,
      acknowledgedByUserId: reopen ? null : prior.acknowledgedByUserId,
      acknowledgedByName: reopen ? null : prior.acknowledgedByName,
      snoozeUntil: reopen ? null : prior.snoozeUntil,
      notificationEpisode: nextEpisode,
      lastDetectedAt: now,
      resolvedAt: null,
      updatedAt: now,
    }).where(eq(hcmLifecycleNotificationTasks.id, prior.id)).returning();

    if (reopen) {
      await recordLifecycleNotificationEvent({
        task: updated,
        eventType: escalationIncreased ? "escalated" : "reopened",
        actor,
        metadata: {
          previousStage: prior.stage,
          stage: updated.stage,
          previousEscalationStage: prior.escalationStage,
          escalationStage: updated.escalationStage,
          snoozeExpired,
        },
      });
    }
    touched.push(updated);
  }

  for (const task of existing) {
    if (task.status === "resolved" || detected.has(task.sourceKey)) continue;
    const [resolved] = await db.update(hcmLifecycleNotificationTasks).set({
      status: "resolved",
      resolvedAt: now,
      snoozeUntil: null,
      updatedAt: now,
    }).where(eq(hcmLifecycleNotificationTasks.id, task.id)).returning();
    await recordLifecycleNotificationEvent({
      task: resolved,
      eventType: "resolved",
      actor,
      metadata: { previousStage: task.stage },
    });
  }

  const deliveries = [];
  for (const task of touched) {
    deliveries.push(...await sendLifecycleTaskNotifications(task, candidates, actor));
  }

  return {
    organizationId,
    detected: detected.size,
    activeTasks: touched.length,
    deliveries: deliveries.length,
  };
}

export async function runScheduledHcmLifecycleNotifications(input: {
  actor?: string;
  now?: Date;
  organizationIds?: number[];
} = {}) {
  const now = input.now ?? new Date();
  const actor = input.actor ?? "System scheduler";
  const organizationIds = input.organizationIds ?? [
    ...new Set(
      (await db.select({ organizationId: userOrganizations.organizationId }).from(userOrganizations))
        .map((row) => row.organizationId),
    ),
  ];

  const results = [];
  for (const organizationId of organizationIds) {
    results.push(await syncOrganizationLifecycleTasks(organizationId, actor, now));
  }
  return results;
}
