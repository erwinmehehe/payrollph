import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { outbox, payrollRuns, userOrganizations, users } from "@/db/schema";
import type { ComplianceCalendarItem, ComplianceCalendarStatus } from "@/lib/compliance-calendar";
import { loadComplianceCalendar, manilaDate } from "@/lib/compliance-calendar-server";
import { queueMessage } from "@/lib/mailer";

export const COMPLIANCE_DEADLINE_ALERT_PURPOSE = "compliance-deadline-digest";
export const COMPLIANCE_DEADLINE_ALERT_ROLES = ["owner", "admin", "payroll", "bookkeeper"] as const;

const ALERT_STATUSES: ComplianceCalendarStatus[] = ["overdue", "verification-required", "exception", "due-soon"];

export type DeadlineAlert = { itemStage: string; item: ComplianceCalendarItem };

export function actionableDeadlineAlerts(items: ComplianceCalendarItem[]): DeadlineAlert[] {
  return items
    .filter((item) => ALERT_STATUSES.includes(item.status))
    .map((item) => ({ itemStage: `${item.id}:${item.status}`, item }));
}

/** Notify only when at least one obligation entered a new actionable stage since the last digest. */
export function hasNewDeadlineStage(current: DeadlineAlert[], previousItemStages: string[]) {
  const previous = new Set(previousItemStages);
  return current.some((alert) => !previous.has(alert.itemStage));
}

const STATUS_LABEL: Partial<Record<ComplianceCalendarStatus, string>> = {
  overdue: "OVERDUE",
  "verification-required": "PAST DUE, VERIFY FILING",
  exception: "EXCEPTION",
  "due-soon": "DUE WITHIN 7 DAYS",
};

export function deadlineDigestBody(input: { recipientName: string; organizationName: string; today: string; alerts: DeadlineAlert[] }) {
  const lines = input.alerts.map(({ item }) =>
    `- [${STATUS_LABEL[item.status] ?? item.status}] ${item.obligation} (${item.applicableMonth}) due ${item.dueDate ?? "date not configured"}\n  ${item.detail}`,
  );
  return [
    `Hi ${input.recipientName},`,
    "",
    `${input.organizationName} has ${input.alerts.length} statutory obligation${input.alerts.length === 1 ? "" : "s"} that need attention as of ${input.today}:`,
    "",
    ...lines,
    "",
    "Open the Compliance Center in Linaw to record payment and filing evidence.",
    "Dates are nominal statutory dates or conservative internal targets; published agency calendars, filer classification, weekends and holidays can change the final date.",
  ].join("\n");
}

async function previousItemStages(organizationId: number, recipient: string) {
  const [last] = await db.select({ metadata: outbox.metadata }).from(outbox)
    .where(and(
      eq(outbox.organizationId, organizationId),
      eq(outbox.recipient, recipient),
      eq(outbox.purpose, COMPLIANCE_DEADLINE_ALERT_PURPOSE),
    ))
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .limit(1);
  const stages = (last?.metadata as { itemStages?: unknown } | undefined)?.itemStages;
  return Array.isArray(stages) ? stages.map(String) : [];
}

export async function runScheduledComplianceDeadlineAlerts(input: { now: Date; organizationIds?: number[] }) {
  const today = manilaDate(input.now);
  const organizationIds = input.organizationIds
    ?? (await db.selectDistinct({ organizationId: payrollRuns.organizationId }).from(payrollRuns))
      .map((row) => row.organizationId);

  const results: { organizationId: number; alerts: number; queued: number; skipped: number }[] = [];
  for (const organizationId of organizationIds) {
    const calendar = await loadComplianceCalendar(organizationId, today);
    if (calendar.kind !== "ready") continue;
    const alerts = actionableDeadlineAlerts(calendar.items);
    if (alerts.length === 0) continue;

    const recipients = await db.select({ userId: users.id, name: users.name, email: users.email, role: userOrganizations.role })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.active, true),
        eq(users.active, true),
        isNull(userOrganizations.orgUnitId),
      ));

    const itemStages = alerts.map((alert) => alert.itemStage).sort();
    const signature = createHash("sha256").update(itemStages.join("|")).digest("hex").slice(0, 24);
    let queued = 0;
    let skipped = 0;
    for (const recipient of recipients) {
      if (!recipient.email || !(COMPLIANCE_DEADLINE_ALERT_ROLES as readonly string[]).includes(recipient.role)) continue;
      if (!hasNewDeadlineStage(alerts, await previousItemStages(organizationId, recipient.email))) {
        skipped += 1;
        continue;
      }
      await queueMessage({
        organizationId,
        recipient: recipient.email,
        subject: `[Compliance] ${alerts.length} statutory deadline${alerts.length === 1 ? "" : "s"} need attention`,
        body: deadlineDigestBody({ recipientName: recipient.name, organizationName: calendar.organizationName, today, alerts }),
        purpose: COMPLIANCE_DEADLINE_ALERT_PURPOSE,
        dedupeKey: `compliance-deadline:${organizationId}:${recipient.userId}:${signature}`,
        metadata: { itemStages, today },
      });
      queued += 1;
    }
    results.push({ organizationId, alerts: alerts.length, queued, skipped });
  }
  return results;
}
