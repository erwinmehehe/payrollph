import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  organizations,
  schedulerState,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { loadStatutoryRemittanceState } from "@/lib/statutory-remittance-state";

const SOURCE_TYPE = "statutory_remittance";
const SCHEDULE_JOB = "statutory-remittance-actions";
const SCHEDULE_INTERVAL_MS = 60 * 60 * 1000;
const LOCAL_CHECK_INTERVAL_MS = 60 * 1000;

let lastLocalScheduleCheck = 0;

export async function syncStatutoryRemittanceActions(
  organizationId: number,
  actor: string,
) {
  const state = await loadStatutoryRemittanceState(organizationId);
  if (!state) {
    return { organizationId, created: 0, reopened: 0, resolved: 0, activeAlerts: 0, missingOrganization: true };
  }

  const existing = await db.select().from(complianceActionTasks)
    .where(and(
      eq(complianceActionTasks.organizationId, organizationId),
      eq(complianceActionTasks.sourceType, SOURCE_TYPE),
    ));

  const existingByKey = new Map(existing.map((task) => [task.sourceKey, task]));
  const activeKeys = new Set(state.alerts.map((alert) => alert.id));
  const now = new Date();
  let created = 0;
  let reopened = 0;
  let resolved = 0;

  await db.transaction(async (tx) => {
    for (const alert of state.alerts) {
      const current = existingByKey.get(alert.id);
      if (!current) {
        await tx.insert(complianceActionTasks).values({
          organizationId,
          sourceType: SOURCE_TYPE,
          sourceKey: alert.id,
          agency: alert.agency,
          applicableMonth: alert.applicableMonth,
          severity: alert.tone,
          title: alert.title,
          detail: alert.detail,
          dueDate: alert.dueDate,
          status: "open",
          firstDetectedAt: now,
          lastDetectedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
        continue;
      }

      const wasResolved = current.status === "resolved";
      await tx.update(complianceActionTasks).set({
        agency: alert.agency,
        applicableMonth: alert.applicableMonth,
        severity: alert.tone,
        title: alert.title,
        detail: alert.detail,
        dueDate: alert.dueDate,
        status: wasResolved ? "open" : current.status,
        acknowledgedAt: wasResolved ? null : current.acknowledgedAt,
        acknowledgedByUserId: wasResolved ? null : current.acknowledgedByUserId,
        acknowledgedByName: wasResolved ? null : current.acknowledgedByName,
        resolvedAt: wasResolved ? null : current.resolvedAt,
        lastDetectedAt: now,
        updatedAt: now,
      }).where(and(
        eq(complianceActionTasks.id, current.id),
        eq(complianceActionTasks.organizationId, organizationId),
      ));
      if (wasResolved) reopened += 1;
    }

    for (const task of existing) {
      if (task.status === "resolved" || activeKeys.has(task.sourceKey)) continue;
      await tx.update(complianceActionTasks).set({
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
      }).where(and(
        eq(complianceActionTasks.id, task.id),
        eq(complianceActionTasks.organizationId, organizationId),
      ));
      resolved += 1;
    }
  });

  if (created || reopened || resolved) {
    await recordAuditEvent({
      organizationId,
      actor,
      action: "Statutory compliance action queue synchronized",
      resource: "SSS · PhilHealth · Pag-IBIG",
      metadata: {
        created,
        reopened,
        resolved,
        activeAlerts: state.alerts.length,
      },
    });
  }

  return {
    organizationId,
    created,
    reopened,
    resolved,
    activeAlerts: state.alerts.length,
    missingOrganization: false,
  };
}

export async function syncAllStatutoryRemittanceActions(actor = "System compliance monitor") {
  const rows = await db.select({ id: organizations.id }).from(organizations);
  const results = [];
  for (const organization of rows) {
    results.push(await syncStatutoryRemittanceActions(organization.id, actor));
  }
  return results;
}

export async function runScheduledStatutoryRemittanceSync(options?: {
  force?: boolean;
  actor?: string;
}) {
  const now = new Date();
  const force = options?.force === true;

  if (!force && Date.now() - lastLocalScheduleCheck < LOCAL_CHECK_INTERVAL_MS) {
    return { skipped: true as const, reason: "local-interval" as const };
  }
  lastLocalScheduleCheck = Date.now();

  const [row] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, SCHEDULE_JOB))
    .limit(1);

  if (!force && row?.lastRunAt && now.getTime() - row.lastRunAt.getTime() < SCHEDULE_INTERVAL_MS) {
    return { skipped: true as const, reason: "scheduler-interval" as const, lastRunAt: row.lastRunAt };
  }

  const results = await syncAllStatutoryRemittanceActions(options?.actor);
  const changed = results.reduce(
    (sum, result) => sum + result.created + result.reopened + result.resolved,
    0,
  );
  const activeAlerts = results.reduce((sum, result) => sum + result.activeAlerts, 0);
  const payload = {
    at: now.toISOString(),
    organizations: results.length,
    changed,
    activeAlerts,
    results: results.slice(0, 50),
  };

  if (row) {
    await db.update(schedulerState).set({
      lastRunAt: now,
      lastResult: payload,
    }).where(eq(schedulerState.id, row.id));
  } else {
    await db.insert(schedulerState).values({
      jobName: SCHEDULE_JOB,
      lastRunAt: now,
      lastResult: payload,
    });
  }

  return { skipped: false as const, ...payload };
}
