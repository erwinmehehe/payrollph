import { randomUUID } from "node:crypto";
import { isCentralSchedulerEnabled } from "@/lib/scheduler-activation";
import { eq, sql } from "drizzle-orm";
import { acquireSchedulerLease, refreshSchedulerLease, releaseSchedulerLease, recordSchedulerCompletion, recordSchedulerFailure } from "@/lib/scheduler-lease";
import { db } from "@/db";
import { schedulerState } from "@/db/schema";
import { drainWebhookRetries } from "@/lib/webhooks";
import { drainOutboxRetries } from "@/lib/mailer";
import { describeFailure, purgeExpiredOperationalData, RetentionPurgeIncompleteError } from "@/lib/data-retention";
import { enhancedPunchEnabled, drainExpiredPunchPhotoBatches } from "@/lib/workforce-punch-evidence";
import { purgeExpiredPunchPhotos } from "@/lib/workforce-punch-retention";
import { drainMarketingLeadNotifications } from "@/lib/marketing-leads";
import { runScheduledStatutoryRemittanceSync } from "@/lib/statutory-remittance-actions";
import { runScheduledContributionCaseEscalations } from "@/lib/statutory-contribution-case-escalations";
import { runDueHrCaseSlaEscalations } from "@/lib/hr-case-sla-escalation";
import { runScheduledHcmDocumentExpiry } from "@/lib/hcm-documents";
import { runScheduledCompensationGovernance } from "@/lib/hcm-compensation";
import { drainCompensationAutomationIntents } from "@/lib/compensation-automation-outbox";
import { runScheduledWorkerEffectiveChanges } from "@/lib/hcm-effective-changes";
import { multiEntityHcmDeferred } from "@/lib/multi-entity-hcm-hold";
import { runScheduledEmploymentTerms } from "@/lib/hcm-employment-terms";
import { runScheduledEmploymentTermDecisions } from "@/lib/hcm-employment-term-decisions";
import { runScheduledHcmLifecycleNotifications } from "@/lib/hcm-lifecycle-notifications";
import { runScheduledPerformanceReminders } from "@/lib/hcm-performance-reminders";
import { runScheduledPerformanceActionReminders } from "@/lib/hcm-performance-action-reminders";
import { runScheduledPerformanceEvidenceSealing } from "@/lib/hcm-performance-evidence-sealing";
import { resumeDueAutomationExecutions } from "@/lib/automation";
import { runScheduledAutomationTemporalEvents } from "@/lib/automation-temporal-events";
import { ClockWatchLeaseLostError } from "@/lib/workforce-clock-watch-lease";
import { sealAuditEvents } from "@/lib/audit-chain";
import { runDueApprovalChainEscalations } from "@/lib/approval-chain-escalation-server";
import { runScheduledComplianceDeadlineAlerts } from "@/lib/compliance-deadline-alerts";

const MIN_INTERVAL_MS = 30_000;

export class SchedulerLeaseLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulerLeaseLostError";
  }
}

export type SchedulerJobFailure = { job: string; message: string };

/** One or more scheduled jobs failed; every other job was still attempted. */
export class SchedulerJobsIncompleteError extends Error {
  readonly failures: SchedulerJobFailure[];
  constructor(failures: SchedulerJobFailure[]) {
    super("Scheduler tick incomplete; failed jobs: " + failures.map((f) => f.job).join(", "));
    this.name = "SchedulerJobsIncompleteError";
    this.failures = failures;
  }
}

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
        throw new SchedulerLeaseLostError("Central scheduler lease lost before scheduled side effect; review partial work.");
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
  // A job that throws must not stop the jobs after it (approval escalations,
  // statutory sync, HCM and compliance work). Its failure is recorded and
  // rethrown after every other job ran; a lost lease is never isolated.
  const failures: SchedulerJobFailure[] = [];
  const isolate = (job: string) => (error: unknown): null => {
    if (error instanceof SchedulerLeaseLostError) throw error;
    if (error instanceof ClockWatchLeaseLostError) throw error;
    // Database errors surface the driver message and SQLSTATE, never the SQL text.
    const { code, message } = describeFailure(job, error);
    failures.push({ job, message: code ? code + ": " + message : message });
    return null;
  };
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
  // A failed retention step (for example a table that was never created) must
  // not stop approval escalations, statutory sync, compliance alerts and the
  // other jobs below. Every step was still attempted; the failure is rethrown
  // after the remaining jobs finish, and the retention marker is not advanced
  // so the whole purge is retried on the next tick.
  if (retentionDue) await assertLeaseOwnership();
  let retention: Awaited<ReturnType<typeof purgeExpiredOperationalData>> | null = null;
  let retentionFailure: RetentionPurgeIncompleteError | null = null;
  if (retentionDue) {
    try {
      retention = await purgeExpiredOperationalData(now.getTime());
    } catch (error) {
      if (!(error instanceof RetentionPurgeIncompleteError)) throw error;
      retentionFailure = error;
    }
  }
  // Retention must continue after selfie collection is disabled; otherwise
  // switching the feature flag OFF strands existing encrypted evidence.
  // Older databases without the optional migration should not fail cleanup.
  let punchPhotoPurge: { purged: number; batches: number } | null = null;
  let punchPhotoFailed = false;
  if (retentionDue) {
    await assertLeaseOwnership();
    try {
      const presence = await db.execute<{ photo_table_exists: boolean }>(
        sql`SELECT to_regclass('public.workforce_punch_photo_evidence') IS NOT NULL AS photo_table_exists`,
      );
      const hasPhotoTable = presence.rows[0]?.photo_table_exists === true;
      if (!hasPhotoTable && enhancedPunchEnabled()) {
        throw Error("Enhanced punch collection enabled before punch evidence migration.");
      }
      if (hasPhotoTable) {
        punchPhotoPurge = await drainExpiredPunchPhotoBatches(
          () => purgeExpiredPunchPhotos(now, 250), assertLeaseOwnership,
        );
      }
    } catch (error) {
      isolate("punchPhotoPurge")(error);
      punchPhotoFailed = true;
    }
  }
  await assertLeaseOwnership();
  const approvalEscalations = await runDueApprovalChainEscalations(now).catch(isolate("approvalEscalations"));
  await assertLeaseOwnership();
  const statutoryRemittanceActions = await runScheduledStatutoryRemittanceSync({
    actor: "System scheduler",
  }).catch(isolate("statutoryRemittanceActions"));
  await assertLeaseOwnership();
  const contributionCaseEscalations = await runScheduledContributionCaseEscalations({
    actor: "System scheduler",
  }).catch(isolate("contributionCaseEscalations"));
  await assertLeaseOwnership();
  const hrCaseSlaEscalations = await runDueHrCaseSlaEscalations(now).catch(isolate("hrCaseSlaEscalations"));
  await assertLeaseOwnership();
  const automationResumes = await resumeDueAutomationExecutions(now, 25).catch(isolate("automationResumes"));
  await assertLeaseOwnership();
  const automationTemporalEvents = await runScheduledAutomationTemporalEvents({ now, assertLeaseOwnership }).catch(isolate("automationTemporalEvents"));

  const [hcmDocumentState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-document-expiry"))
    .limit(1);
  const hcmDocumentDue =
    !hcmDocumentState?.lastRunAt
    || now.getTime() - hcmDocumentState.lastRunAt.getTime() >= 6 * 60 * 60 * 1000;
  if (hcmDocumentDue) await assertLeaseOwnership();
  const hcmDocumentExpiry = hcmDocumentDue
    ? await runScheduledHcmDocumentExpiry({ actor: "System scheduler", now }).catch(isolate("hcmDocumentExpiry"))
    : null;

  await assertLeaseOwnership();
  // Defer scheduled effective HCM mutations while the multi-entity HCM
  // freeze is active. Legacy feature-OFF scheduling is unchanged.
  const hcmEffectiveChanges = multiEntityHcmDeferred()
    ? [{ status: "skipped", reason: "ENTITY_HCM_DEFERRED" }]
    : await runScheduledWorkerEffectiveChanges({
        actor: "System scheduler",
        now,
        limit: 50,
      }).catch(isolate("hcmEffectiveChanges"));

  await assertLeaseOwnership();
  const hcmEmploymentTerms = await runScheduledEmploymentTerms({
    actor: "System scheduler",
    now,
    limit: 100,
  }).catch(isolate("hcmEmploymentTerms"));

  await assertLeaseOwnership();
  const hcmEmploymentTermDecisions = await runScheduledEmploymentTermDecisions({
    actor: "System scheduler",
    now,
    limit: 100,
  }).catch(isolate("hcmEmploymentTermDecisions"));

  await assertLeaseOwnership();
  const hcmCompensation = await runScheduledCompensationGovernance({
    actor: "System scheduler",
    now,
    limit: 100,
  }).catch(isolate("hcmCompensation"));

  // Secondary durable compensation delivery uses the same guarded scheduler
  // lease as the rest of the enabled queue and is never a payroll release.
  await assertLeaseOwnership();
  let compensationAutomationDelivery: Awaited<ReturnType<typeof drainCompensationAutomationIntents>> | { error: string };
  try {
    compensationAutomationDelivery = await drainCompensationAutomationIntents(new Date(), 25);
    // The drain deliberately returns an unconfirmed status for individual
    // dispatch exceptions, preserving the durable intent for investigation.
    // That is a partial scheduler failure, not a successfully delivered batch.
    if (compensationAutomationDelivery.results.some((intent) => intent.reason === "dispatch_error_unconfirmed")) {
      failures.push({
        job: "compensationAutomationDelivery",
        message: "DISPATCH_UNCONFIRMED: One or more compensation dispatches are unconfirmed; inspect the durable intent ledger.",
      });
    }
  } catch (error) {
    isolate("compensationAutomationDelivery")(error);
    compensationAutomationDelivery = { error: "Compensation automation delivery queue unavailable; inspect the durable intent ledger." };
  }
  await assertLeaseOwnership();

  let auditChainSeal: { sealed: number } | { error: string };
  try {
    auditChainSeal = { sealed: await sealAuditEvents(1000) };
  } catch (error) {
    isolate("auditChainSeal")(error);
    auditChainSeal = { error: "Audit chain sealing unavailable; inspect the audit sealer and schema readiness." };
  }
  await assertLeaseOwnership();

  const [complianceAlertState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "compliance-deadline-alerts"))
    .limit(1);
  const complianceAlertsDue =
    !complianceAlertState?.lastRunAt
    || now.getTime() - complianceAlertState.lastRunAt.getTime() >= 60 * 60 * 1000;
  let complianceDeadlineAlerts: Awaited<ReturnType<typeof runScheduledComplianceDeadlineAlerts>> | { error: string } | null = null;
  if (complianceAlertsDue) {
    await assertLeaseOwnership();
    try {
      complianceDeadlineAlerts = await runScheduledComplianceDeadlineAlerts({ now });
    } catch (error) {
      isolate("complianceDeadlineAlerts")(error);
      complianceDeadlineAlerts = { error: "Compliance deadline alerts failed; the calendar remains available in the Compliance Center." };
    }
    // On partial delivery, retry next tick. The outbox uses a durable
    // per-recipient stage dedupe key, so an already queued digest is not
    // delivered again merely because a later recipient or employer failed.
    if (Array.isArray(complianceDeadlineAlerts)) {
      await assertLeaseOwnership();
      const complianceAlertPayload = { at: now.toISOString(), results: complianceDeadlineAlerts };
      if (complianceAlertState) {
        await db.update(schedulerState).set({ lastRunAt: now, lastResult: complianceAlertPayload })
          .where(eq(schedulerState.id, complianceAlertState.id));
      } else {
        await db.insert(schedulerState).values({
          jobName: "compliance-deadline-alerts",
          lastRunAt: now,
          lastResult: complianceAlertPayload,
        });
      }
    }
  }

  const [hcmLifecycleNotificationState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-lifecycle-notifications"))
    .limit(1);
  const hcmLifecycleNotificationsDue =
    !hcmLifecycleNotificationState?.lastRunAt
    || now.getTime() - hcmLifecycleNotificationState.lastRunAt.getTime() >= 60 * 60 * 1000;
  if (hcmLifecycleNotificationsDue) await assertLeaseOwnership();
  const hcmLifecycleNotifications = hcmLifecycleNotificationsDue
    ? await runScheduledHcmLifecycleNotifications({ actor: "System scheduler", now }).catch(isolate("hcmLifecycleNotifications"))
    : null;

  const [performanceReminderState] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, "hcm-performance-reminders"))
    .limit(1);
  const performanceRemindersDue =
    !performanceReminderState?.lastRunAt
    || now.getTime() - performanceReminderState.lastRunAt.getTime() >= 60 * 60 * 1000;
  if (performanceRemindersDue) await assertLeaseOwnership();
  const performanceReminders = performanceRemindersDue
    ? await runScheduledPerformanceReminders({ actor: "System scheduler", now }).catch(isolate("performanceReminders"))
    : null;
  if (performanceRemindersDue) await assertLeaseOwnership();
  const performanceActionReminders = performanceRemindersDue
    ? await runScheduledPerformanceActionReminders({ actor: "System scheduler", now }).catch(isolate("performanceActionReminders"))
    : null;

  // A due job that failed returns null: leave its marker alone so it is retried.
  if (performanceRemindersDue && performanceReminders && performanceActionReminders) {
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
    ? await runScheduledPerformanceEvidenceSealing({ actor: "System scheduler", now }).catch(isolate("performanceEvidenceSealing"))
    : null;

  if (performanceEvidenceDue && performanceEvidenceSealing) {
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

  if (hcmLifecycleNotificationsDue && hcmLifecycleNotifications) {
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

  if (hcmDocumentDue && hcmDocumentExpiry) {
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

  if (retentionDue && !retentionFailure && !punchPhotoFailed) {
    await assertLeaseOwnership();
    const retentionPayload = { at: now.toISOString(), deleted: retention, punchPhotos: punchPhotoPurge };
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
    approvalEscalations,
    punchPhotoPurge,
    statutoryRemittanceActions,
    contributionCaseEscalations,
    hrCaseSlaEscalations,
    automationResumes,
    automationTemporalEvents,
    hcmDocumentExpiry,
    hcmEffectiveChanges,
    hcmEmploymentTerms,
    hcmEmploymentTermDecisions,
    hcmCompensation,
    compensationAutomationDelivery,
    auditChainSeal,
    complianceDeadlineAlerts,
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

  // Every other job has now run. Surface retention, direct and previously
  // swallowed failures before recording any successful completion receipt.
  if (failures.length > 0) {
    if (retentionFailure) {
      for (const f of retentionFailure.failures) failures.push({ job: "retention." + f.step, message: f.code ?? f.message });
    }
    // Retain a bounded, sanitized failure receipt under the same live lease.
    // The previous successful delivery-drain receipt must remain unchanged.
    await assertLeaseOwnership();
    const recorded = await recordSchedulerFailure(ownerToken, failures);
    if (!recorded) throw new SchedulerLeaseLostError("Scheduler lease lost before saving failed job evidence.");
    throw new SchedulerJobsIncompleteError(failures);
  }
  if (retentionFailure) throw retentionFailure;

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
