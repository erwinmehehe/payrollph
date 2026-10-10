import { randomUUID } from "node:crypto";
import { isCentralSchedulerEnabled } from "@/lib/scheduler-activation";
import { eq, sql } from "drizzle-orm";
import { acquireSchedulerLease, refreshSchedulerLease, releaseSchedulerLease, recordSchedulerCompletion } from "@/lib/scheduler-lease";
import { db } from "@/db";
import { schedulerState } from "@/db/schema";
import { drainWebhookRetries } from "@/lib/webhooks";
import { drainOutboxRetries } from "@/lib/mailer";
import { purgeExpiredOperationalData } from "@/lib/data-retention";
import { drainMarketingLeadNotifications } from "@/lib/marketing-leads";
import { runScheduledStatutoryRemittanceSync } from "@/lib/statutory-remittance-actions";
import { runScheduledContributionCaseEscalations } from "@/lib/statutory-contribution-case-escalations";
import { runScheduledHcmDocumentExpiry } from "@/lib/hcm-documents";
import { runScheduledCompensationGovernance } from "@/lib/hcm-compensation";
import { drainCompensationAutomationIntents } from "@/lib/compensation-automation-outbox";
import { runScheduledWorkerEffectiveChanges } from "@/lib/hcm-effective-changes";
import { runScheduledEmploymentTerms } from "@/lib/hcm-employment-terms";
import { runScheduledEmploymentTermDecisions } from "@/lib/hcm-employment-term-decisions";
import { runScheduledHcmLifecycleNotifications } from "@/lib/hcm-lifecycle-notifications";
import { runScheduledPerformanceReminders } from "@/lib/hcm-performance-reminders";
import { runScheduledPerformanceActionReminders } from "@/lib/hcm-performance-action-reminders";
import { runScheduledPerformanceEvidenceSealing } from "@/lib/hcm-performance-evidence-sealing";
import { resumeDueAutomationExecutions } from "@/lib/automation";
import { runScheduledAutomationTemporalEvents } from "@/lib/automation-temporal-events";

const MIN_INTERVAL_MS = 30_000;

/**
 * Worker-triggered scheduler used by /api/jobs/tick and the dedicated worker.
 * Public health probes never execute scheduler work or drain queues.
 */
export async function tickScheduler(force = false) {
  // An enabled payroll worker does not authorize automatic HR, salary,
  // statutory or retention jobs. Require separate, deliberate activation.
  if (!isCentralSchedulerEnabled()) {
    return { skipped: true as const, reason: "scheduler-disabled" as const };
  }
  const ownerToken = randomUUID();
  if (!(await acquireSchedulerLease(ownerToken))) {
    return { skipped: true as const, reason: "another-worker" as const };
  }

  let active = true;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void refreshSchedulerLease(ownerToken).then((renewed) => {
      if (active && !renewed) {
        leaseLost = true;
        console.error("Central scheduler lease was taken by another worker.");
      }
    }).catch((error) => {
      if (active) {
        leaseLost = true;
        console.error("Central scheduler lease renewal failed:", error instanceof Error ? error.message : error);
      }
    });
  }, 30_000);
  heartbeat.unref();

  let completed = false;
  try {
    const result = await runScheduledJobs(force, ownerToken, async () => {
      // A heartbeat only marks lease loss; it cannot stop an in-flight job.
      // Reconfirm ownership before starting each financial/HR side effect.
      if (leaseLost || !(await refreshSchedulerLease(ownerToken))) {
        leaseLost = true;
        throw new Error("Central scheduler lease lost before scheduled side effect; review partial work.");
      }
    });
    if (leaseLost) {
      throw new Error("Central scheduler lease renewal failed. Review completed jobs before retrying.");
    }
    completed = true;
    return result;
  } finally {
    active = false;
    clearInterval(heartbeat);
    const released = await releaseSchedulerLease(ownerToken, completed ? "completed" : "failed");
    if (completed && !released) {
      // If ownership changed while the last task completed, the former
      // worker must never acknowledge the run as safely finished.
      throw new Error("Central scheduler completed work but no longer owned the lease at release.");
    }
  }
}

async function runScheduledJobs(
  force: boolean,
  ownerToken: string,
  assertLeaseOwnership: () => Promise<void>,
) {
  const now = new Date();
  const [row] = await db.select().from(schedulerState).where(eq(schedulerState.jobName, "delivery-drain")).limit(1);

  if (!force && row?.lastRunAt && now.getTime() - row.lastRunAt.getTime() < MIN_INTERVAL_MS) {
    return { skipped: true as const, reason: "interval", lastRunAt: row.lastRunAt };
  }

  await assertLeaseOwnership();
  const webhookResults = await drainWebhookRetries(25);
  await assertLeaseOwnership();
  const mailResults = await drainOutboxRetries(25);
  const mailRetried = mailResults.filter((item) => item.retried);
  await assertLeaseOwnership();
  const marketingLeadResults = await drainMarketingLeadNotifications(25);

  const [retentionState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "retention-purge"))
    .limit(1);
  const retentionDue =
    !retentionState?.lastRunAt
    || now.getTime() - retentionState.lastRunAt.getTime() >= 24 * 60 * 60 * 1000;
  if (retentionDue) await assertLeaseOwnership();
  const retention = retentionDue ? await purgeExpiredOperationalData(now.getTime()) : null;
  await assertLeaseOwnership();
  const statutoryRemittanceActions = await runScheduledStatutoryRemittanceSync({
    actor: "System scheduler",
  });
  await assertLeaseOwnership();
  const contributionCaseEscalations = await runScheduledContributionCaseEscalations({
    actor: "System scheduler",
  });
  await assertLeaseOwnership();
  const automationResumes = await resumeDueAutomationExecutions(now, 25);
  await assertLeaseOwnership();
  const automationTemporalEvents = await runScheduledAutomationTemporalEvents({ now });

  const [hcmDocumentState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-document-expiry"))
    .limit(1);
  const hcmDocumentDue =
    !hcmDocumentState?.lastRunAt
    || now.getTime() - hcmDocumentState.lastRunAt.getTime() >= 6 * 60 * 60 * 1000;
  if (hcmDocumentDue) await assertLeaseOwnership();
  const hcmDocumentExpiry = hcmDocumentDue
    ? await runScheduledHcmDocumentExpiry({ actor: "System scheduler", now })
    : null;

  await assertLeaseOwnership();
  const hcmEffectiveChanges = await runScheduledWorkerEffectiveChanges({
    actor: "System scheduler",
    now,
    limit: 50,
  });

  await assertLeaseOwnership();
  const hcmEmploymentTerms = await runScheduledEmploymentTerms({
    actor: "System scheduler",
    now,
    limit: 100,
  });

  await assertLeaseOwnership();
  const hcmEmploymentTermDecisions = await runScheduledEmploymentTermDecisions({
    actor: "System scheduler",
    now,
    limit: 100,
  });

  await assertLeaseOwnership();
  const hcmCompensation = await runScheduledCompensationGovernance({
    actor: "System scheduler",
    now,
    limit: 100,
  });

  // Secondary durable compensation delivery uses the same guarded scheduler
  // lease as the rest of the enabled queue and is never a payroll release.
  await assertLeaseOwnership();
  let compensationAutomationDelivery: Awaited<ReturnType<typeof drainCompensationAutomationIntents>> | { error: string };
  try {
    compensationAutomationDelivery = await drainCompensationAutomationIntents(new Date(), 25);
  } catch {
    compensationAutomationDelivery = { error: "Compensation automation delivery queue unavailable; inspect the durable intent ledger." };
  }
  await assertLeaseOwnership();

  const [hcmLifecycleNotificationState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-lifecycle-notifications"))
    .limit(1);
  const hcmLifecycleNotificationsDue =
    !hcmLifecycleNotificationState?.lastRunAt
    || now.getTime() - hcmLifecycleNotificationState.lastRunAt.getTime() >= 60 * 60 * 1000;
  if (hcmLifecycleNotificationsDue) await assertLeaseOwnership();
  const hcmLifecycleNotifications = hcmLifecycleNotificationsDue
    ? await runScheduledHcmLifecycleNotifications({ actor: "System scheduler", now })
    : null;

  const [performanceReminderState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-performance-reminders"))
    .limit(1);
  const performanceRemindersDue =
    !performanceReminderState?.lastRunAt
    || now.getTime() - performanceReminderState.lastRunAt.getTime() >= 60 * 60 * 1000;
  if (performanceRemindersDue) await assertLeaseOwnership();
  const performanceReminders = performanceRemindersDue
    ? await runScheduledPerformanceReminders({ actor: "System scheduler", now })
    : null;
  if (performanceRemindersDue) await assertLeaseOwnership();
  const performanceActionReminders = performanceRemindersDue
    ? await runScheduledPerformanceActionReminders({ actor: "System scheduler", now })
    : null;

  if (performanceRemindersDue) {
    await assertLeaseOwnership();
    const performanceReminderPayload = {
      at: now.toISOString(),
      reviewOrganizations: performanceReminders?.length ?? 0,
      actionOrganizations: performanceActionReminders?.length ?? 0,
      reviewResults: performanceReminders?.slice(0, 50) ?? [],
      actionResults: performanceActionReminders?.slice(0, 50) ?? [],
    };
    if (performanceReminderState) {
      await db.update(schedulerState).set({
        lastRunAt: now,
        lastResult: performanceReminderPayload,
      }).where(eq(schedulerState.id, performanceReminderState.id));
    } else {
      await db.insert(schedulerState).values({
        jobName: "hcm-performance-reminders",
        lastRunAt: now,
        lastResult: performanceReminderPayload,
      });
    }
  }

  const [performanceEvidenceState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-performance-evidence-sealing"))
    .limit(1);
  const performanceEvidenceDue =
    !performanceEvidenceState?.lastRunAt
    || now.getTime() - performanceEvidenceState.lastRunAt.getTime() >= 6 * 60 * 60 * 1000;
  if (performanceEvidenceDue) await assertLeaseOwnership();
  const performanceEvidenceSealing = performanceEvidenceDue
    ? await runScheduledPerformanceEvidenceSealing({ actor: "System scheduler", now })
    : null;

  if (performanceEvidenceDue) {
    await assertLeaseOwnership();
    const performanceEvidencePayload = {
      at: now.toISOString(),
      sealedCycles: performanceEvidenceSealing?.length ?? 0,
      results: performanceEvidenceSealing?.slice(0, 50) ?? [],
    };
    if (performanceEvidenceState) {
      await db.update(schedulerState).set({
        lastRunAt: now,
        lastResult: performanceEvidencePayload,
      }).where(eq(schedulerState.id, performanceEvidenceState.id));
    } else {
      await db.insert(schedulerState).values({
        jobName: "hcm-performance-evidence-sealing",
        lastRunAt: now,
        lastResult: performanceEvidencePayload,
      });
    }
  }

  if (hcmLifecycleNotificationsDue) {
    await assertLeaseOwnership();
    const lifecyclePayload = {
      at: now.toISOString(),
      organizations: hcmLifecycleNotifications?.length ?? 0,
      results: hcmLifecycleNotifications?.slice(0, 50) ?? [],
    };
    if (hcmLifecycleNotificationState) {
      await db.update(schedulerState).set({
        lastRunAt: now,
        lastResult: lifecyclePayload,
      }).where(eq(schedulerState.id, hcmLifecycleNotificationState.id));
    } else {
      await db.insert(schedulerState).values({
        jobName: "hcm-lifecycle-notifications",
        lastRunAt: now,
        lastResult: lifecyclePayload,
      });
    }
  }

  if (hcmDocumentDue) {
    await assertLeaseOwnership();
    const hcmDocumentPayload = {
      at: now.toISOString(),
      processed: hcmDocumentExpiry?.length ?? 0,
      results: hcmDocumentExpiry?.slice(0, 50) ?? [],
    };
    if (hcmDocumentState) {
      await db.update(schedulerState).set({
        lastRunAt: now,
        lastResult: hcmDocumentPayload,
      }).where(eq(schedulerState.id, hcmDocumentState.id));
    } else {
      await db.insert(schedulerState).values({
        jobName: "hcm-document-expiry",
        lastRunAt: now,
        lastResult: hcmDocumentPayload,
      });
    }
  }

  if (retentionDue) {
    await assertLeaseOwnership();
    const retentionPayload = { at: now.toISOString(), deleted: retention };
    if (retentionState) {
      await db.update(schedulerState).set({
        lastRunAt: now,
        lastResult: retentionPayload,
      }).where(eq(schedulerState.id, retentionState.id));
    } else {
      await db.insert(schedulerState).values({
        jobName: "retention-purge",
        lastRunAt: now,
        lastResult: retentionPayload,
      });
    }
  }

  const payload = {
    drained: webhookResults.length + mailRetried.length + marketingLeadResults.filter((item) => item.notified).length,
    webhookRetries: webhookResults.length,
    mailRetries: mailRetried.length,
    marketingLeadNotifications: marketingLeadResults.filter((item) => item.notified).length,
    retentionPurge: retention,
    statutoryRemittanceActions,
    contributionCaseEscalations,
    automationResumes,
    automationTemporalEvents,
    hcmDocumentExpiry,
    hcmEffectiveChanges,
    hcmEmploymentTerms,
    hcmEmploymentTermDecisions,
    hcmCompensation,
    compensationAutomationDelivery,
    hcmLifecycleNotifications,
    performanceReminders,
    performanceActionReminders,
    performanceEvidenceSealing,
    at: now.toISOString(),
    results: {
      webhooks: webhookResults.slice(0, 10),
      mail: mailResults.slice(0, 10),
      marketingLeads: marketingLeadResults.slice(0, 10),
    },
  };

  await assertLeaseOwnership();
  // Final liveness evidence is written under a row lock on the current
  // lease in the SAME SQL statement. A stale owner cannot race a takeover.
  const committed = await recordSchedulerCompletion(ownerToken, payload);
  if (!committed) {
    throw new Error("Central scheduler lost its lease before completion receipt.");
  }

  return { skipped: false as const, ...payload };
}

export async function recordHealthSnapshot(ok: boolean, latencyMs: number, detail: string) {
  await db.execute(sql`
    insert into health_snapshots (ok, latency_ms, detail)
    values (${ok}, ${latencyMs}, ${detail})
  `);
  await db.execute(sql`
    delete from health_snapshots
    where id not in (select id from health_snapshots order by created_at desc limit 500)
  `);
}
