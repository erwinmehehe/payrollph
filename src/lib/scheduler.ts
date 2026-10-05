import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { schedulerState } from "@/db/schema";
import { drainWebhookRetries } from "@/lib/webhooks";
import { drainOutboxRetries } from "@/lib/mailer";
import { purgeExpiredOperationalData } from "@/lib/data-retention";
import { queueStatutoryRemittanceReminders } from "@/lib/statutory-remittance-reminders";

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

  const [remittanceState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "statutory-remittance-reminders"))
    .limit(1);
  const remittanceReminderDue =
    !remittanceState?.lastRunAt
    || now.getTime() - remittanceState.lastRunAt.getTime() >= 24 * 60 * 60 * 1000;
  const remittanceReminders = remittanceReminderDue
    ? await queueStatutoryRemittanceReminders(now)
    : null;

  if (remittanceReminderDue) {
    const remittancePayload = remittanceReminders ?? { at: now.toISOString(), queued: 0 };
    if (remittanceState) {
      await db.update(schedulerState).set({
        lastRunAt: now,
        lastResult: remittancePayload,
      }).where(eq(schedulerState.id, remittanceState.id));
    } else {
      await db.insert(schedulerState).values({
        jobName: "statutory-remittance-reminders",
        lastRunAt: now,
        lastResult: remittancePayload,
      });
    }
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
    statutoryRemittanceReminders: remittanceReminders,
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
