import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  organizations,
  performanceCycles,
  performanceReminderEvents,
  performanceReminderTasks,
  performanceReviews,
  userOrganizations,
  users,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { philippineBusinessDate } from "@/lib/hcm-employment-terms";
import { queueMessage } from "@/lib/mailer";

type ReminderTask = typeof performanceReminderTasks.$inferSelect;

type ReminderSignal = {
  organizationId: number;
  cycleId: number;
  reviewId: number;
  employeeId: number;
  employeeName: string;
  cycleName: string;
  reminderType: "self_assessment" | "manager_review";
  sourceKey: string;
  stage: string;
  dueDate: string;
  ownerUserId: number | null;
  ownerName: string | null;
  ownerEmail: string | null;
};

function dayDifference(dueDate: string, today: string) {
  return Math.round(
    (Date.parse(dueDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000,
  );
}

export function performanceReminderStage(daysUntil: number) {
  if (daysUntil > 7) return null;
  if (daysUntil >= 4) return "t7";
  if (daysUntil >= 2) return "t3";
  if (daysUntil === 1) return "t1";
  if (daysUntil === 0) return "due";
  if (daysUntil >= -2) return "overdue";
  return "overdue_escalated";
}

function reminderSubject(signal: ReminderSignal) {
  return signal.reminderType === "self_assessment"
    ? "[Performance] Self-assessment due for " + signal.cycleName
    : "[Performance] Manager review due for " + signal.employeeName;
}

function reminderBody(signal: ReminderSignal, recipientName: string) {
  const action = signal.reminderType === "self_assessment"
    ? "Complete your self-assessment and reflection in Employee Self-Service."
    : "Complete the manager review, required structured items, and final rating in Performance.";
  const urgency = signal.stage === "overdue_escalated"
    ? "This item is overdue and has crossed the escalation threshold."
    : signal.stage === "overdue"
      ? "This item is overdue."
      : signal.stage === "due"
        ? "This item is due today."
        : "This is an upcoming performance deadline.";

  return [
    "Hi " + recipientName + ",",
    "",
    action,
    "Cycle: " + signal.cycleName,
    "Employee: " + signal.employeeName,
    "Due date: " + signal.dueDate,
    urgency,
    "",
    "This reminder only tracks performance workflow completion. It does not change compensation or payroll.",
  ].join("\n");
}

async function recordReminderEvent(
  task: ReminderTask,
  eventType: string,
  actor: string,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(performanceReminderEvents).values({
    organizationId: task.organizationId,
    taskId: task.id,
    reviewId: task.reviewId,
    eventType,
    actorName: actor,
    metadata,
  });
}

async function signalsForOrganization(organizationId: number, now: Date): Promise<ReminderSignal[]> {
  const today = philippineBusinessDate(now);
  const [cycles, reviews, staff, memberships] = await Promise.all([
    db.select().from(performanceCycles).where(and(
      eq(performanceCycles.organizationId, organizationId),
      ne(performanceCycles.status, "completed"),
    )),
    db.select().from(performanceReviews).where(eq(performanceReviews.organizationId, organizationId)),
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
      membershipActive: userOrganizations.active,
      userActive: users.active,
    })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(eq(userOrganizations.organizationId, organizationId)),
  ]);

  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const employeeById = new Map(staff.map((employee) => [employee.id, employee]));
  const userById = new Map(memberships.filter((row) => row.membershipActive && row.userActive).map((row) => [row.userId, row]));
  const employeeAccountByEmployeeId = new Map(
    memberships
      .filter((row) => row.membershipActive && row.userActive && row.role === "employee" && row.employeeId)
      .map((row) => [row.employeeId!, row]),
  );

  const signals: ReminderSignal[] = [];
  for (const review of reviews) {
    const cycle = cycleById.get(review.cycleId);
    if (!cycle) continue;
    const daysUntil = dayDifference(cycle.endDate, today);
    const stage = performanceReminderStage(daysUntil);
    if (!stage) continue;
    const employee = employeeById.get(review.employeeId);
    if (!employee) continue;
    const employeeName = employee.firstName + " " + employee.lastName;

    if (cycle.requireSelfAssessment && (!review.selfScore || !review.employeeReflection)) {
      const owner = employeeAccountByEmployeeId.get(review.employeeId) ?? null;
      signals.push({
        organizationId,
        cycleId: cycle.id,
        reviewId: review.id,
        employeeId: review.employeeId,
        employeeName,
        cycleName: cycle.name,
        reminderType: "self_assessment",
        sourceKey: "review:" + review.id + ":self-assessment",
        stage,
        dueDate: cycle.endDate,
        ownerUserId: owner?.userId ?? null,
        ownerName: owner?.name ?? null,
        ownerEmail: owner?.email ?? null,
      });
    }

    if (review.status !== "completed") {
      const owner = review.reviewerUserId ? userById.get(review.reviewerUserId) ?? null : null;
      signals.push({
        organizationId,
        cycleId: cycle.id,
        reviewId: review.id,
        employeeId: review.employeeId,
        employeeName,
        cycleName: cycle.name,
        reminderType: "manager_review",
        sourceKey: "review:" + review.id + ":manager-review",
        stage,
        dueDate: cycle.endDate,
        ownerUserId: owner?.userId ?? null,
        ownerName: owner?.name ?? null,
        ownerEmail: owner?.email ?? null,
      });
    }
  }

  return signals;
}

async function syncOrganizationPerformanceReminders(
  organizationId: number,
  actor: string,
  now: Date,
) {
  const signals = await signalsForOrganization(organizationId, now);
  const existing = await db.select().from(performanceReminderTasks)
    .where(eq(performanceReminderTasks.organizationId, organizationId));
  const existingByKey = new Map(existing.map((task) => [task.sourceKey, task]));
  const activeKeys = new Set(signals.map((signal) => signal.sourceKey));
  const results: Array<{ taskId: number; action: string; stage: string; notified: boolean }> = [];

  for (const task of existing) {
    if (task.status === "open" && !activeKeys.has(task.sourceKey)) {
      const [resolved] = await db.update(performanceReminderTasks).set({
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(performanceReminderTasks.id, task.id)).returning();
      await recordReminderEvent(resolved, "resolved", actor, { reason: "performance_requirement_completed_or_cycle_closed" });
      await recordAuditEvent({
        organizationId,
        actor,
        action: "Performance reminder resolved",
        resource: "Review #" + task.reviewId,
        metadata: { reminderTaskId: task.id, reminderType: task.reminderType },
      });
      results.push({ taskId: task.id, action: "resolved", stage: task.stage, notified: false });
    }
  }

  for (const signal of signals) {
    const current = existingByKey.get(signal.sourceKey);
    let task: ReminderTask;
    let action = "unchanged";
    if (!current) {
      [task] = await db.insert(performanceReminderTasks).values({
        organizationId,
        cycleId: signal.cycleId,
        reviewId: signal.reviewId,
        employeeId: signal.employeeId,
        reminderType: signal.reminderType,
        sourceKey: signal.sourceKey,
        stage: signal.stage,
        dueDate: signal.dueDate,
        status: "open",
        ownerUserId: signal.ownerUserId,
        ownerName: signal.ownerName,
      }).returning();
      action = "created";
      await recordReminderEvent(task, "created", actor, { stage: signal.stage });
    } else if (
      current.stage !== signal.stage
      || current.status !== "open"
      || current.ownerUserId !== signal.ownerUserId
      || current.dueDate !== signal.dueDate
    ) {
      const stageChanged = current.stage !== signal.stage;
      [task] = await db.update(performanceReminderTasks).set({
        stage: signal.stage,
        dueDate: signal.dueDate,
        status: "open",
        ownerUserId: signal.ownerUserId,
        ownerName: signal.ownerName,
        notificationEpisode: stageChanged ? current.notificationEpisode + 1 : current.notificationEpisode,
        resolvedAt: null,
        updatedAt: now,
      }).where(eq(performanceReminderTasks.id, current.id)).returning();
      action = stageChanged ? "advanced" : "updated";
      await recordReminderEvent(task, action, actor, { previousStage: current.stage, stage: signal.stage });
    } else {
      task = current;
    }

    let notified = false;
    if (signal.ownerUserId && signal.ownerEmail) {
      const delivery = await queueMessage({
        organizationId,
        recipient: signal.ownerEmail,
        subject: reminderSubject(signal).slice(0, 180),
        body: reminderBody(signal, signal.ownerName ?? "there"),
        purpose: "hcm-performance-reminder",
        dedupeKey: [
          "performance-reminder",
          task.id,
          signal.stage,
          "episode-" + task.notificationEpisode,
          "user-" + signal.ownerUserId,
        ].join(":").slice(0, 200),
        metadata: {
          reminderTaskId: task.id,
          reviewId: task.reviewId,
          cycleId: task.cycleId,
          reminderType: task.reminderType,
          stage: signal.stage,
          recipientUserId: signal.ownerUserId,
        },
        audit: {
          actor,
          metadata: {
            reminderTaskId: task.id,
            reviewId: task.reviewId,
            reminderType: task.reminderType,
            stage: signal.stage,
            recipientUserId: signal.ownerUserId,
          },
        },
      });
      notified = !("deduplicated" in delivery && delivery.deduplicated);
      if (notified) {
        await db.update(performanceReminderTasks).set({
          lastNotifiedAt: now,
          updatedAt: now,
        }).where(eq(performanceReminderTasks.id, task.id));
        await recordReminderEvent(task, signal.stage.startsWith("overdue") ? "escalated" : "notified", actor, {
          stage: signal.stage,
          ownerUserId: signal.ownerUserId,
          outboxId: delivery.id,
        });
      }
    }

    results.push({ taskId: task.id, action, stage: signal.stage, notified });
  }

  return results;
}

export async function runScheduledPerformanceReminders(input: {
  actor: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  const results = [];
  for (const organization of orgs) {
    const organizationResults = await syncOrganizationPerformanceReminders(
      organization.id,
      input.actor,
      now,
    );
    if (organizationResults.length) {
      results.push({ organizationId: organization.id, results: organizationResults });
    }
  }
  return results;
}
