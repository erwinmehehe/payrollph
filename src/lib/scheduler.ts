import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { schedulerState } from "@/db/schema";
import { drainWebhookRetries } from "@/lib/webhooks";
import { drainOutboxRetries } from "@/lib/mailer";
import { purgeExpiredOperationalData } from "@/lib/data-retention";
import { runScheduledStatutoryRemittanceSync } from "@/lib/statutory-remittance-actions";
import { runScheduledContributionCaseEscalations } from "@/lib/statutory-contribution-case-escalations";
import { runScheduledHcmDocumentExpiry } from "@/lib/hcm-documents";
import { runScheduledCompensationGovernance } from "@/lib/hcm-compensation";
import { runScheduledWorkerEffectiveChanges } from "@/lib/hcm-effective-changes";
import { runScheduledEmploymentTerms } from "@/lib/hcm-employment-terms";
import { runScheduledEmploymentTermDecisions } from "@/lib/hcm-employment-term-decisions";
import { runScheduledHcmLifecycleNotifications } from "@/lib/hcm-lifecycle-notifications";

const MIN_INTERVAL_MS = 30_000;

/**
 * Worker-triggered scheduler used by /api/jobs/tick and the dedicated worker.
 * Public health probes never execute scheduler work or drain queues.
 */
export async function tickScheduler(force = false) {
  const now = new Date();
  const [row] = await db.select().from(schedulerState).where(eq(schedulerState.jobName, "delivery-drain")).limit(1);

  if (!force && row?.lastRunAt && now.getTime() - row.lastRunAt.getTime() < MIN_INTERVAL_MS) {
    return { skipped: true as const, reason: "interval", lastRunAt: row.lastRunAt };
  }

  const webhookResults = await drainWebhookRetries(25);
  const mailResults = await drainOutboxRetries(25);
  const mailRetried = mailResults.filter((item) => item.retried);

  const [retentionState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "retention-purge"))
    .limit(1);
  const retentionDue =
    !retentionState?.lastRunAt
    || now.getTime() - retentionState.lastRunAt.getTime() >= 24 * 60 * 60 * 1000;
  const retention = retentionDue ? await purgeExpiredOperationalData(now.getTime()) : null;
  const statutoryRemittanceActions = await runScheduledStatutoryRemittanceSync({
    actor: "System scheduler",
  });
  const contributionCaseEscalations = await runScheduledContributionCaseEscalations({
    actor: "System scheduler",
  });

  const [hcmDocumentState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-document-expiry"))
    .limit(1);
  const hcmDocumentDue =
    !hcmDocumentState?.lastRunAt
    || now.getTime() - hcmDocumentState.lastRunAt.getTime() >= 6 * 60 * 60 * 1000;
  const hcmDocumentExpiry = hcmDocumentDue
    ? await runScheduledHcmDocumentExpiry({ actor: "System scheduler", now })
    : null;

  const hcmEffectiveChanges = await runScheduledWorkerEffectiveChanges({
    actor: "System scheduler",
    now,
    limit: 50,
  });

  const hcmEmploymentTerms = await runScheduledEmploymentTerms({
    actor: "System scheduler",
    now,
    limit: 100,
  });

  const hcmEmploymentTermDecisions = await runScheduledEmploymentTermDecisions({
    actor: "System scheduler",
    now,
    limit: 100,
  });

  const hcmCompensation = await runScheduledCompensationGovernance({
    actor: "System scheduler",
    now,
    limit: 100,
  });

  const [hcmLifecycleNotificationState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-lifecycle-notifications"))
    .limit(1);
  const hcmLifecycleNotificationsDue =
    !hcmLifecycleNotificationState?.lastRunAt
    || now.getTime() - hcmLifecycleNotificationState.lastRunAt.getTime() >= 60 * 60 * 1000;
  const hcmLifecycleNotifications = hcmLifecycleNotificationsDue
    ? await runScheduledHcmLifecycleNotifications({ actor: "System scheduler", now })
    : null;

  if (hcmLifecycleNotificationsDue) {
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
    drained: webhookResults.length + mailRetried.length,
    webhookRetries: webhookResults.length,
    mailRetries: mailRetried.length,
    retentionPurge: retention,
    statutoryRemittanceActions,
    contributionCaseEscalations,
    hcmDocumentExpiry,
    hcmEffectiveChanges,
    hcmEmploymentTerms,
    hcmEmploymentTermDecisions,
    hcmCompensation,
    hcmLifecycleNotifications,
    at: now.toISOString(),
    results: {
      webhooks: webhookResults.slice(0, 10),
      mail: mailResults.slice(0, 10),
    },
  };

  if (row) {
    await db.update(schedulerState).set({ lastRunAt: now, lastResult: payload }).where(eq(schedulerState.id, row.id));
  } else {
    await db.insert(schedulerState).values({ jobName: "delivery-drain", lastRunAt: now, lastResult: payload });
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
