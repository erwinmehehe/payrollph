import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  legalEntities,
  organizations,
  schedulerState,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { loadStatutoryRemittanceState } from "@/lib/statutory-remittance-state";
import { queueStatutoryComplianceEscalations } from "@/lib/statutory-remittance-escalations";
import { daysUntil, type RemittanceAlert } from "@/lib/statutory-remittance-alerts";
import { runAutomationEventSafely } from "@/lib/automation";

const SOURCE_TYPE = "statutory_remittance";
const SCHEDULE_JOB = "statutory-remittance-actions";
const SCHEDULE_INTERVAL_MS = 60 * 60 * 1000;
const LOCAL_CHECK_INTERVAL_MS = 60 * 1000;

let lastLocalScheduleCheck = 0;

function isRemittanceDueAutomationAlert(alert: RemittanceAlert) {
  if (!alert.dueDate) return false;
  if (alert.id.startsWith("coverage:")) {
    return alert.tone === "warning" || alert.tone === "danger";
  }
  return alert.id.startsWith("batch:")
    && (
      alert.title.endsWith("remittance is due soon")
      || alert.title.endsWith("remittance is overdue")
    );
}

type StatutoryRemittanceSyncResult = {
  organizationId: number;
  legalEntityId?: number;
  created: number;
  reopened: number;
  resolved: number;
  activeAlerts: number;
  escalationQueued: number;
  escalationDeduplicated: number;
  escalationError: string | null;
  automationEvents: number;
  automationErrors: number;
  missingOrganization: boolean;
};

export async function syncStatutoryRemittanceActions(
  organizationId: number,
  actor: string,
  legalEntityId?: number,
): Promise<StatutoryRemittanceSyncResult> {
  if (!legalEntityId) {
    const entities = await db.select().from(legalEntities).where(and(
      eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.active, true),
    ));
    if (entities.length === 0) {
      return { organizationId, created: 0, reopened: 0, resolved: 0, activeAlerts: 0, escalationQueued: 0, escalationDeduplicated: 0, escalationError: null, automationEvents: 0, automationErrors: 0, missingOrganization: true };
    }

    const now = new Date();
    let legacyResolved = 0;
    const legacyTasks = await db.select().from(complianceActionTasks).where(and(
      eq(complianceActionTasks.organizationId, organizationId),
      eq(complianceActionTasks.sourceType, SOURCE_TYPE),
    ));
    for (const task of legacyTasks) {
      if (task.sourceKey.startsWith("legal-entity:") || task.status === "resolved") continue;
      const rows = await db.update(complianceActionTasks).set({
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
      }).where(and(
        eq(complianceActionTasks.id, task.id),
        ne(complianceActionTasks.status, "resolved"),
      )).returning({ id: complianceActionTasks.id });
      legacyResolved += rows.length;
    }

    const results = [];
    for (const entity of entities) {
      results.push(await syncStatutoryRemittanceActions(organizationId, actor, entity.id));
    }
    return {
      organizationId,
      created: results.reduce((sum, result) => sum + result.created, 0),
      reopened: results.reduce((sum, result) => sum + result.reopened, 0),
      resolved: legacyResolved + results.reduce((sum, result) => sum + result.resolved, 0),
      activeAlerts: results.reduce((sum, result) => sum + result.activeAlerts, 0),
      escalationQueued: results.reduce((sum, result) => sum + result.escalationQueued, 0),
      escalationDeduplicated: results.reduce((sum, result) => sum + result.escalationDeduplicated, 0),
      escalationError: results.map((result) => result.escalationError).filter(Boolean).join("; ") || null,
      automationEvents: results.reduce((sum, result) => sum + result.automationEvents, 0),
      automationErrors: results.reduce((sum, result) => sum + result.automationErrors, 0),
      missingOrganization: false,
    };
  }

  const state = await loadStatutoryRemittanceState(organizationId, legalEntityId);
  if (!state) {
    return { organizationId, legalEntityId, created: 0, reopened: 0, resolved: 0, activeAlerts: 0, escalationQueued: 0, escalationDeduplicated: 0, escalationError: null, automationEvents: 0, automationErrors: 0, missingOrganization: true };
  }

  const sourcePrefix = `legal-entity:${legalEntityId}:`;
  const existing = (await db.select().from(complianceActionTasks)
    .where(and(
      eq(complianceActionTasks.organizationId, organizationId),
      eq(complianceActionTasks.sourceType, SOURCE_TYPE),
    )))
    .filter((task) => task.sourceKey.startsWith(sourcePrefix));

  const existingByKey = new Map(existing.map((task) => [task.sourceKey, task]));
  const activeKeys = new Set(state.alerts.map((alert) => `${sourcePrefix}${alert.id}`));
  const now = new Date();
  let created = 0;
  let reopened = 0;
  let resolved = 0;
  const automationCandidates: Array<{
    taskId: number;
    escalationEpisode: number;
    alert: RemittanceAlert;
  }> = [];

  await db.transaction(async (tx) => {
    for (const alert of state.alerts) {
      const sourceKey = `${sourcePrefix}${alert.id}`;
      const current = existingByKey.get(sourceKey);
      if (!current) {
        const inserted = await tx.insert(complianceActionTasks).values({
          organizationId,
          sourceType: SOURCE_TYPE,
          sourceKey,
          agency: alert.agency,
          applicableMonth: alert.applicableMonth,
          severity: alert.tone,
          severityChangedAt: now,
          title: `${state.legalEntity.code} · ${alert.title}`.slice(0, 180),
          detail: `${state.legalEntity.displayName} · ${alert.detail}`.slice(0, 360),
          dueDate: alert.dueDate,
          status: "open",
          firstDetectedAt: now,
          lastDetectedAt: now,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing({
          target: [
            complianceActionTasks.organizationId,
            complianceActionTasks.sourceType,
            complianceActionTasks.sourceKey,
          ],
        }).returning({
          id: complianceActionTasks.id,
          escalationEpisode: complianceActionTasks.escalationEpisode,
        });
        if (inserted.length > 0) {
          created += 1;
          if (isRemittanceDueAutomationAlert(alert)) {
            automationCandidates.push({
              taskId: inserted[0].id,
              escalationEpisode: inserted[0].escalationEpisode,
              alert,
            });
          }
        }
        continue;
      }

      const severityChanged = current.severity !== alert.tone;
      const alertFields = {
        agency: alert.agency,
        applicableMonth: alert.applicableMonth,
        severity: alert.tone,
        severityChangedAt: severityChanged ? now : current.severityChangedAt,
        title: `${state.legalEntity.code} · ${alert.title}`.slice(0, 180),
        detail: `${state.legalEntity.displayName} · ${alert.detail}`.slice(0, 360),
        dueDate: alert.dueDate,
        lastDetectedAt: now,
        updatedAt: now,
      };

      if (current.status === "resolved") {
        const reopenedRows = await tx.update(complianceActionTasks).set({
          ...alertFields,
          status: "open",
          acknowledgedAt: null,
          acknowledgedByUserId: null,
          acknowledgedByName: null,
          resolvedAt: null,
          severityChangedAt: now,
          escalationEpisode: current.escalationEpisode + 1,
        }).where(and(
          eq(complianceActionTasks.id, current.id),
          eq(complianceActionTasks.organizationId, organizationId),
          eq(complianceActionTasks.status, "resolved"),
        )).returning({
          id: complianceActionTasks.id,
          escalationEpisode: complianceActionTasks.escalationEpisode,
        });
        if (reopenedRows.length > 0) {
          reopened += 1;
          if (isRemittanceDueAutomationAlert(alert)) {
            automationCandidates.push({
              taskId: reopenedRows[0].id,
              escalationEpisode: reopenedRows[0].escalationEpisode,
              alert,
            });
          }
        }
      } else {
        await tx.update(complianceActionTasks).set(alertFields).where(and(
          eq(complianceActionTasks.id, current.id),
          eq(complianceActionTasks.organizationId, organizationId),
          ne(complianceActionTasks.status, "resolved"),
        ));
        if (severityChanged && isRemittanceDueAutomationAlert(alert)) {
          automationCandidates.push({
            taskId: current.id,
            escalationEpisode: current.escalationEpisode,
            alert,
          });
        }
      }
    }

    for (const task of existing) {
      if (task.status === "resolved" || activeKeys.has(task.sourceKey)) continue;
      const resolvedRows = await tx.update(complianceActionTasks).set({
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
      }).where(and(
        eq(complianceActionTasks.id, task.id),
        eq(complianceActionTasks.organizationId, organizationId),
        ne(complianceActionTasks.status, "resolved"),
      )).returning({ id: complianceActionTasks.id });
      if (resolvedRows.length > 0) resolved += 1;
    }
  });

  let automationEvents = 0;
  let automationErrors = 0;
  for (const candidate of automationCandidates) {
    const daysUntilDue = candidate.alert.dueDate
      ? daysUntil(candidate.alert.dueDate, state.today)
      : null;
    automationEvents += 1;
    try {
      await runAutomationEventSafely({
        organizationId,
        trigger: "government.remittance_due",
        eventKey: `government-remittance-due:${legalEntityId}:${candidate.taskId}:${candidate.escalationEpisode}:${candidate.alert.tone}`,
        context: {
          legalEntityId,
          legalEntityCode: state.legalEntity.code,
          legalEntityName: state.legalEntity.displayName,
          complianceActionTaskId: candidate.taskId,
          statutoryAgency: candidate.alert.agency,
          applicableMonth: candidate.alert.applicableMonth,
          dueDate: candidate.alert.dueDate,
          daysUntilDue: daysUntilDue,
          remittanceAlertTone: candidate.alert.tone,
          remittanceAlertId: candidate.alert.id,
          title: candidate.alert.title,
          detail: candidate.alert.detail,
        },
      });
    } catch {
      automationErrors += 1;
    }
  }

  if (created || reopened || resolved) {
    await recordAuditEvent({
      organizationId,
      actor,
      action: "Statutory compliance action queue synchronized",
      resource: "SSS · PhilHealth · Pag-IBIG",
      metadata: {
        legalEntityId,
        legalEntityCode: state.legalEntity.code,
        created,
        reopened,
        resolved,
        activeAlerts: state.alerts.length,
        automationEvents,
        automationErrors,
      },
    });
  }

  let escalationQueued = 0;
  let escalationDeduplicated = 0;
  let escalationError: string | null = null;
  try {
    const escalationResults = await queueStatutoryComplianceEscalations({
      organizationId,
      actor,
    });
    escalationQueued = escalationResults.filter((result) => !result.deduplicated).length;
    escalationDeduplicated = escalationResults.filter((result) => result.deduplicated).length;
  } catch (error) {
    escalationError = error instanceof Error ? error.message : "Unknown escalation queue error";
    try {
      await recordAuditEvent({
        organizationId,
        actor,
        action: "Statutory compliance escalation queue failed",
        resource: "SSS · PhilHealth · Pag-IBIG",
        metadata: { error: escalationError },
      });
    } catch {
      // The action queue remains authoritative even when escalation delivery telemetry fails.
    }
  }

  return {
    organizationId,
    legalEntityId,
    created,
    reopened,
    resolved,
    activeAlerts: state.alerts.length,
    escalationQueued,
    escalationDeduplicated,
    escalationError,
    automationEvents,
    automationErrors,
    missingOrganization: false,
  };
}

export async function syncAllStatutoryRemittanceActions(actor = "System compliance monitor") {
  const rows = await db.select({ id: organizations.id }).from(organizations);
  const results = [];
  for (const organization of rows) {
    try {
      results.push(await syncStatutoryRemittanceActions(organization.id, actor));
    } catch (error) {
      results.push({
        organizationId: organization.id,
        created: 0,
        reopened: 0,
        resolved: 0,
        activeAlerts: 0,
        escalationQueued: 0,
        escalationDeduplicated: 0,
        escalationError: null,
        automationEvents: 0,
        automationErrors: 0,
        missingOrganization: false,
        error: error instanceof Error ? error.message : "Unknown remittance monitor error",
      });
    }
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
  const automationEvents = results.reduce((sum, result) => sum + ("automationEvents" in result ? Number(result.automationEvents ?? 0) : 0), 0);
  const automationErrors = results.reduce((sum, result) => sum + ("automationErrors" in result ? Number(result.automationErrors ?? 0) : 0), 0);
  const failures = results.filter((result) => "error" in result && Boolean(result.error)).length;
  const escalationsQueued = results.reduce((sum, result) => sum + ("escalationQueued" in result ? Number(result.escalationQueued ?? 0) : 0), 0);
  const escalationFailures = results.filter((result) => "escalationError" in result && Boolean(result.escalationError)).length;
  const payload = {
    at: now.toISOString(),
    organizations: results.length,
    changed,
    activeAlerts,
    automationEvents,
    automationErrors,
    failures,
    escalationsQueued,
    escalationFailures,
    results: results.slice(0, 50),
  };

  await db.insert(schedulerState).values({
    jobName: SCHEDULE_JOB,
    lastRunAt: now,
    lastResult: payload,
  }).onConflictDoUpdate({
    target: schedulerState.jobName,
    set: {
      lastRunAt: now,
      lastResult: payload,
    },
  });

  return { skipped: false as const, ...payload };
}
