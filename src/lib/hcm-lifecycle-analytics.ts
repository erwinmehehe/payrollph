import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  hcmEmploymentDecisionDocuments,
  hcmEmploymentDecisionNotes,
  hcmEmploymentTermDecisions,
  hcmLifecycleNotificationTasks,
} from "@/db/schema";
import { loadEmploymentLifecycleReadiness } from "@/lib/hcm-lifecycle-readiness-server";
import { philippineBusinessDate } from "@/lib/hcm-employment-terms";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 90;

function hoursBetween(start: Date | null, end: Date | null) {
  if (!start || !end) return null;
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
}

function average(values: Array<number | null>) {
  const usable = values.filter((value): value is number => value != null);
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function pct(part: number, whole: number) {
  if (!whole) return "0.0%";
  return `${(part / whole * 100).toFixed(1)}%`;
}

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function summarizeEmploymentLifecycleGovernance(input: {
  today: string;
  windowStart: Date;
  decisions: Array<typeof hcmEmploymentTermDecisions.$inferSelect>;
  noteDecisionIds: Set<number>;
  attachmentDecisionIds: Set<number>;
  notificationTasks: Array<typeof hcmLifecycleNotificationTasks.$inferSelect>;
  readiness: Awaited<ReturnType<typeof loadEmploymentLifecycleReadiness>>;
}) {
  const { decisions, noteDecisionIds, attachmentDecisionIds, notificationTasks, readiness } = input;
  const requestedInWindow = decisions.filter((decision) => decision.createdAt >= input.windowStart);
  const currentPending = decisions.filter((decision) => decision.status === "pending_approval");
  const currentScheduled = decisions.filter((decision) => decision.status === "scheduled");
  const currentFailed = decisions.filter((decision) => decision.status === "failed");
  const approvedInWindow = decisions.filter((decision) =>
    decision.approvedAt != null && decision.approvedAt >= input.windowStart,
  );
  const appliedInWindow = decisions.filter((decision) =>
    decision.appliedAt != null && decision.appliedAt >= input.windowStart,
  );
  const cancelledInWindow = decisions.filter((decision) =>
    decision.cancelledAt != null && decision.cancelledAt >= input.windowStart,
  );
  const sealedInWindow = approvedInWindow.filter((decision) =>
    Boolean(decision.evidenceSnapshotSha256 && decision.evidenceSealedAt),
  );
  const pendingWithNotes = currentPending.filter((decision) => noteDecisionIds.has(decision.id));
  const pendingWithAttachments = currentPending.filter((decision) => attachmentDecisionIds.has(decision.id));

  const approvalHours = average(
    approvedInWindow.map((decision) => hoursBetween(decision.createdAt, decision.approvedAt)),
  );

  const nonRenewals = decisions.filter((decision) => decision.decisionKind === "non_renew");
  const handoffReady = nonRenewals.filter((decision) =>
    decision.status === "applied" && decision.separationHandoffStatus === "ready",
  );
  const handoffStarted = nonRenewals.filter((decision) =>
    decision.status === "applied" && decision.separationHandoffStatus === "started",
  );
  const handoffCompletedInWindow = nonRenewals.filter((decision) =>
    decision.separationHandoffStatus === "completed"
    && decision.separationHandoffCompletedAt
    && decision.separationHandoffCompletedAt >= input.windowStart,
  );
  const handoffStartHours = average(
    nonRenewals.map((decision) =>
      hoursBetween(decision.approvedAt, decision.separationHandoffStartedAt),
    ),
  );
  const handoffCompletionHours = average(
    nonRenewals.map((decision) =>
      hoursBetween(decision.separationHandoffStartedAt, decision.separationHandoffCompletedAt),
    ),
  );

  const activeNotifications = notificationTasks.filter((task) => task.status !== "resolved");
  const escalatedNotifications = activeNotifications.filter((task) => task.escalationStage >= 2);
  const unassignedNotifications = activeNotifications.filter((task) => task.ownerUserId == null);
  const snoozedNotifications = activeNotifications.filter((task) => task.status === "snoozed");

  const byKind = new Map<string, {
    total: number;
    applied: number;
    pending: number;
    cancelled: number;
    failed: number;
  }>();
  for (const decision of requestedInWindow) {
    const row = byKind.get(decision.decisionKind) ?? {
      total: 0,
      applied: 0,
      pending: 0,
      cancelled: 0,
      failed: 0,
    };
    row.total += 1;
    if (decision.status === "applied") row.applied += 1;
    if (decision.status === "pending_approval" || decision.status === "scheduled") row.pending += 1;
    if (decision.status === "cancelled") row.cancelled += 1;
    if (decision.status === "failed") row.failed += 1;
    byKind.set(decision.decisionKind, row);
  }

  return {
    windowDecisionCount: requestedInWindow.length,
    actionRequired: readiness.summary.actionRequired,
    upcoming: readiness.summary.upcoming,
    unconfigured: readiness.summary.unconfigured,
    inProgress: readiness.summary.inProgress,
    governedWorkers: Math.max(0, readiness.summary.total - readiness.summary.unconfigured),
    pendingApproval: currentPending.length,
    scheduledDecisions: currentScheduled.length,
    failedDecisions: currentFailed.length,
    approvedInWindow: approvedInWindow.length,
    appliedInWindow: appliedInWindow.length,
    cancelledInWindow: cancelledInWindow.length,
    approvalHours,
    sealedInWindow: sealedInWindow.length,
    pendingWithNotes: pendingWithNotes.length,
    pendingWithAttachments: pendingWithAttachments.length,
    handoffReady: handoffReady.length,
    handoffStarted: handoffStarted.length,
    handoffCompletedInWindow: handoffCompletedInWindow.length,
    handoffStartHours,
    handoffCompletionHours,
    activeNotifications: activeNotifications.length,
    escalatedNotifications: escalatedNotifications.length,
    unassignedNotifications: unassignedNotifications.length,
    snoozedNotifications: snoozedNotifications.length,
    decisionKinds: [...byKind.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, counts]) => ({ kind, ...counts })),
  };
}

export async function buildEmploymentLifecycleGovernanceReport(input: {
  organizationId: number;
  now?: Date;
  windowDays?: number;
}) {
  const now = input.now ?? new Date();
  const windowDays = Math.max(1, Math.min(input.windowDays ?? DEFAULT_WINDOW_DAYS, 366));
  const windowStart = new Date(now.getTime() - (windowDays - 1) * DAY_MS);
  const readiness = await loadEmploymentLifecycleReadiness(
    input.organizationId,
    philippineBusinessDate(now),
  );

  const [decisions, notes, attachments, notificationTasks] = await Promise.all([
    db.select().from(hcmEmploymentTermDecisions)
      .where(eq(hcmEmploymentTermDecisions.organizationId, input.organizationId)),
    db.select({ decisionId: hcmEmploymentDecisionNotes.decisionId })
      .from(hcmEmploymentDecisionNotes)
      .where(eq(hcmEmploymentDecisionNotes.organizationId, input.organizationId)),
    db.select({ decisionId: hcmEmploymentDecisionDocuments.decisionId })
      .from(hcmEmploymentDecisionDocuments)
      .where(eq(hcmEmploymentDecisionDocuments.organizationId, input.organizationId)),
    db.select().from(hcmLifecycleNotificationTasks)
      .where(eq(hcmLifecycleNotificationTasks.organizationId, input.organizationId)),
  ]);

  const summary = summarizeEmploymentLifecycleGovernance({
    today: readiness.today,
    windowStart,
    decisions,
    noteDecisionIds: new Set(notes.map((row) => row.decisionId)),
    attachmentDecisionIds: new Set(attachments.map((row) => row.decisionId)),
    notificationTasks,
    readiness,
  });

  const rows: string[][] = [
    [
      "Reporting window",
      `Trailing ${windowDays} days`,
      `Decision activity from ${windowStart.toISOString().slice(0, 10)} through ${now.toISOString().slice(0, 10)}; current-state metrics are as of ${readiness.today}.`,
    ],
    [
      "Lifecycle policy",
      readiness.policy.persisted ? `v${readiness.policy.version}` : "System defaults",
      `Action window ${readiness.policy.actionWindowDays} days · reminders ${readiness.policy.reminderDays.join("/")} · overdue escalation ${readiness.policy.overdueEscalationDays.join("/")} days.`,
    ],
    [
      "Workers with governed terms",
      String(summary.governedWorkers),
      "Active workers currently covered by the governed employment-term ledger.",
    ],
    [
      "Lifecycle action required",
      String(summary.actionRequired),
      "Current probation/contract decisions, failed decisions, or non-renewal handoffs requiring governed action.",
    ],
    [
      "Lifecycle upcoming",
      String(summary.upcoming),
      `Current lifecycle review/end dates inside the ${readiness.policy.actionWindowDays}-day action window.`,
    ],
    [
      "Workers without governed terms",
      String(summary.unconfigured),
      "Active workers whose employment terms have not yet been configured in the governed HCM ledger.",
    ],
    [
      "Decisions awaiting approval",
      String(summary.pendingApproval),
      "Current pending employment-term decisions requiring maker-checker review.",
    ],
    [
      "Approved decisions awaiting effective date",
      String(summary.scheduledDecisions),
      "Current scheduled decisions that are approved but not yet applied.",
    ],
    [
      "Lifecycle workflows in progress",
      String(summary.inProgress),
      "Current approved future decisions or linked Separation workflows still in progress.",
    ],
    [
      "Failed employment decisions",
      String(summary.failedDecisions),
      "Current failed governed decisions requiring retry or cancellation.",
    ],
    [
      "Decision requests",
      String(summary.windowDecisionCount),
      `Employment-term decisions created in the trailing ${windowDays}-day window.`,
    ],
    [
      "Decision approvals",
      String(summary.approvedInWindow),
      summary.approvalHours == null
        ? "No approved decisions in the reporting window."
        : `Average request-to-approval elapsed time: ${summary.approvalHours.toFixed(1)} hours.`,
    ],
    [
      "Applied employment decisions",
      String(summary.appliedInWindow),
      "Governed decisions that reached their application state in the reporting window.",
    ],
    [
      "Cancelled employment decisions",
      String(summary.cancelledInWindow),
      "Decision requests cancelled in the reporting window.",
    ],
    [
      "Evidence-sealed approvals",
      `${summary.sealedInWindow} / ${summary.approvedInWindow}`,
      `${pct(summary.sealedInWindow, summary.approvedInWindow)} of approved decisions in the window carry a sealed Core 3.5 evidence snapshot.`,
    ],
    [
      "Pending decisions with review notes",
      `${summary.pendingWithNotes} / ${summary.pendingApproval}`,
      "Descriptive evidence coverage only; this does not determine legal or policy sufficiency.",
    ],
    [
      "Pending decisions with attachments",
      `${summary.pendingWithAttachments} / ${summary.pendingApproval}`,
      "Descriptive evidence coverage only; attached files remain governed by the Core 3.5 evidence packet.",
    ],
    [
      "Non-renewal handoffs ready",
      String(summary.handoffReady),
      "Approved non-renewals that have not yet started the authoritative Separation workflow.",
    ],
    [
      "Non-renewal Separations in progress",
      String(summary.handoffStarted),
      summary.handoffStartHours == null
        ? "No measured approval-to-Separation start interval is available."
        : `Average approval-to-Separation start elapsed time: ${summary.handoffStartHours.toFixed(1)} hours.`,
    ],
    [
      "Non-renewal handoffs completed",
      String(summary.handoffCompletedInWindow),
      summary.handoffCompletionHours == null
        ? `Completed handoffs in the trailing ${windowDays}-day window.`
        : `Completed in the trailing ${windowDays}-day window; average Separation start-to-final-pay release: ${summary.handoffCompletionHours.toFixed(1)} hours.`,
    ],
    [
      "Open lifecycle notification tasks",
      String(summary.activeNotifications),
      "Current Core 3.4 lifecycle tasks that are open, acknowledged, or snoozed but not resolved.",
    ],
    [
      "Escalated lifecycle notification tasks",
      String(summary.escalatedNotifications),
      "Current lifecycle tasks at escalation stage 2 or higher.",
    ],
    [
      "Unassigned lifecycle notification tasks",
      String(summary.unassignedNotifications),
      "Current lifecycle tasks without an accountable owner.",
    ],
    [
      "Snoozed lifecycle notification tasks",
      String(summary.snoozedNotifications),
      "Current reminders temporarily snoozed; stage changes can reopen them earlier.",
    ],
  ];

  for (const kind of summary.decisionKinds) {
    rows.push([
      `Decision mix · ${readable(kind.kind)}`,
      String(kind.total),
      `Applied ${kind.applied} · pending/scheduled ${kind.pending} · cancelled ${kind.cancelled} · failed ${kind.failed}.`,
    ]);
  }

  return {
    key: "lifecycle" as const,
    columns: ["Metric", "Current", "Context"],
    rows,
    generatedAt: now.toISOString(),
    window: {
      days: windowDays,
      start: windowStart.toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
    },
    summary,
  };
}
