import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, userOrganizations, users } from "@/db/schema";
import { runAutomationEventSafely } from "@/lib/automation";
import { readScheduleReceiptView } from "@/lib/workforce-schedule-receipt-server";
import { receiptPilotAllowed } from "@/lib/workforce-schedule-receipt";
import { explicitReminderEmployerIds, scheduleReviewSignals } from "@/lib/workforce-schedule-review-reminders";

const MAX_ACCOUNT_ROWS = 200;

/**
 * Hourly, optional read of authoritative employee schedule receipts. Reuses
 * the existing Automation Studio event log, per-rule idempotency and mailer
 * outbox/retry pipeline; never sends email without a separately published rule.
 * No cross-tenant or cohort-partial scan is allowed.
 */
export async function emitWorkforceScheduleReviewReminders(now: Date = new Date()) {
  if (process.env.WFM_SCHEDULE_REVIEW_REMINDERS_ENABLED !== "true"
    || process.env.WFM_SCHEDULE_RECEIPTS_ENABLED !== "true") {
    return { skipped: true as const, reason: "disabled" };
  }
  if (!Number.isFinite(now.getTime())) {
    return { skipped: true as const, reason: "invalid-clock" };
  }
  const allowlist = explicitReminderEmployerIds(process.env.WFM_SCHEDULE_REVIEW_REMINDERS_ORG_IDS);
  if (!allowlist || allowlist.some(orgId => !receiptPilotAllowed(orgId,
    process.env.WFM_SCHEDULE_RECEIPTS_ENABLED,
    process.env.WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS))) {
    return { skipped: true as const, reason: "invalid-or-unapproved-employer" };
  }
  const candidates = await db.select({
    organizationId: userOrganizations.organizationId,
    userId: users.id,
    employeeId: employees.id,
  }).from(userOrganizations)
    .innerJoin(users, and(
      eq(users.id, userOrganizations.userId),
      eq(users.active, true), eq(users.role, "employee"),
    ))
    .innerJoin(employees, and(
      eq(employees.id, users.employeeId),
      eq(employees.organizationId, userOrganizations.organizationId),
      eq(employees.status, "Active"),
    ))
    .where(and(
      inArray(userOrganizations.organizationId, allowlist),
      eq(userOrganizations.active, true), eq(userOrganizations.role, "employee"),
    ))
    .orderBy(asc(userOrganizations.organizationId), asc(employees.id), asc(users.id))
    .limit(MAX_ACCOUNT_ROWS + 1);

  // A partial list would falsely report that other staff have no reminders.
  if (candidates.length > MAX_ACCOUNT_ROWS) {
    return { skipped: true as const, reason: "cohort-too-large", limit: MAX_ACCOUNT_ROWS };
  }
  const accountCounts = new Map<string, number>();
  for (const row of candidates) {
    const key = row.organizationId + ":" + row.employeeId;
    accountCounts.set(key, (accountCounts.get(key) ?? 0) + 1);
  }

  let inspected = 0, attempted = 0, failures = 0, ambiguousAccounts = 0;
  for (const row of candidates) {
    if (accountCounts.get(row.organizationId + ":" + row.employeeId) !== 1) {
      ambiguousAccounts++;
      continue;
    }
    try {
      // The service verifies the exact active employee session binding again
      // after acquiring the same roster lock used by schedule publishers.
      const view = await readScheduleReceiptView(row, () =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now));
      inspected++;
      for (const signal of scheduleReviewSignals({ ...row, view, now })) {
        const outcomes = await runAutomationEventSafely({
          organizationId: row.organizationId,
          employeeId: row.employeeId,
          trigger: "workforce.schedule_review_due",
          eventKey: signal.eventKey,
          context: {
            workDate: signal.workDate,
            reviewReason: signal.reason,
            currentScheduleHash: signal.snapshotHash,
            action: "review_current_schedule",
            employeeScheduleRoute: "/self/schedule-receipts",
            // This is not statutory delivery, clock evidence, worker discipline or consent.
            attendanceAffected: false, payrollAffected: false,
          },
        });
        attempted++;
        if (outcomes.some(outcome => outcome.status === "failed"
          || outcome.status === "engine_error")) failures++;
      }
    } catch {
      // One malformed/retired identity must not prevent another employer's
      // source reads, and cannot be treated as an acknowledged schedule.
      failures++;
    }
  }
  return { skipped: false as const, inspected, attempted, failures, ambiguousAccounts };
}
