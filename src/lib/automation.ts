import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  automationExecutions,
  automationRules,
  provisioningTasks,
  sessions,
  users,
} from "@/db/schema";
import { dispatchWebhook, type WebhookEvent } from "@/lib/webhooks";

export const LIFECYCLE_TRIGGERS = [
  "employee.hired",
  "employee.moved",
  "employee.separated",
] as const;

export type LifecycleTrigger = (typeof LIFECYCLE_TRIGGERS)[number];

export type LifecycleContext = {
  orgUnitId?: number | null;
  previousOrgUnitId?: number | null;
  employmentType?: string | null;
  title?: string | null;
};

type RuleCondition = {
  orgUnitId?: number;
  fromOrgUnitId?: number;
  toOrgUnitId?: number;
  employmentType?: string;
  titleContains?: string;
};

type CreateTaskAction = {
  type: "create_task";
  title: string;
  owner?: string;
  kind?: string;
};

type RevokeSessionsAction = {
  type: "revoke_sessions";
};

type WebhookAction = {
  type: "webhook";
};

export type LifecycleAction = CreateTaskAction | RevokeSessionsAction | WebhookAction;

export function validLifecycleConditions(value: unknown): value is RuleCondition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.orgUnitId !== undefined && !Number.isInteger(Number(row.orgUnitId))) return false;
  if (row.fromOrgUnitId !== undefined && !Number.isInteger(Number(row.fromOrgUnitId))) return false;
  if (row.toOrgUnitId !== undefined && !Number.isInteger(Number(row.toOrgUnitId))) return false;
  if (row.employmentType !== undefined && typeof row.employmentType !== "string") return false;
  if (row.titleContains !== undefined && typeof row.titleContains !== "string") return false;
  return true;
}

export function normalizeLifecycleActions(value: unknown): LifecycleAction[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) return null;
  const actions: LifecycleAction[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const action = raw as Record<string, unknown>;
    const type = String(action.type ?? "");
    if (type === "create_task") {
      const title = String(action.title ?? "").trim();
      if (!title) return null;
      actions.push({
        type,
        title: title.slice(0, 160),
        owner: String(action.owner ?? "People Ops").slice(0, 80),
        kind: String(action.kind ?? "automation").slice(0, 24),
      });
      continue;
    }
    if (type === "revoke_sessions") {
      actions.push({ type });
      continue;
    }
    if (type === "webhook") {
      actions.push({ type });
      continue;
    }
    return null;
  }
  return actions;
}

function conditionMatches(condition: RuleCondition, trigger: LifecycleTrigger, context: LifecycleContext) {
  if (condition.orgUnitId !== undefined && context.orgUnitId !== condition.orgUnitId) return false;
  if (condition.fromOrgUnitId !== undefined && context.previousOrgUnitId !== condition.fromOrgUnitId) return false;
  if (condition.toOrgUnitId !== undefined && context.orgUnitId !== condition.toOrgUnitId) return false;
  if (condition.employmentType && context.employmentType !== condition.employmentType) return false;
  if (condition.titleContains && !String(context.title ?? "").toLowerCase().includes(condition.titleContains.toLowerCase())) return false;
  if (trigger !== "employee.moved" && (condition.fromOrgUnitId !== undefined || condition.toOrgUnitId !== undefined)) return false;
  return true;
}

function webhookEvent(trigger: LifecycleTrigger): WebhookEvent {
  if (trigger === "employee.hired") return "employee.onboarded";
  if (trigger === "employee.moved") return "employee.moved";
  return "employee.offboarded";
}


/**
 * Lifecycle automation is intentionally post-commit and failure-isolated:
 * hiring, moving, or separating an employee remains authoritative even when a
 * secondary task/webhook action fails. Each rule/event pair is idempotent.
 */
export async function runLifecycleAutomations(input: {
  organizationId: number;
  employeeId: number;
  trigger: LifecycleTrigger;
  eventKey: string;
  context?: LifecycleContext;
}) {
  const rules = await db.select().from(automationRules).where(and(
    eq(automationRules.organizationId, input.organizationId),
    eq(automationRules.trigger, input.trigger),
    eq(automationRules.active, true),
  ));
  const outcomes: Array<{ ruleId: number; status: string; result?: unknown; error?: string }> = [];

  for (const rule of rules) {
    const conditions = validLifecycleConditions(rule.conditions) ? rule.conditions : {};
    if (!conditionMatches(conditions, input.trigger, input.context ?? {})) continue;
    const actions = normalizeLifecycleActions(rule.actions);
    if (!actions) {
      outcomes.push({ ruleId: rule.id, status: "failed", error: "Rule actions are invalid." });
      continue;
    }

    const [execution] = await db.insert(automationExecutions).values({
      organizationId: input.organizationId,
      ruleId: rule.id,
      employeeId: input.employeeId,
      trigger: input.trigger,
      eventKey: input.eventKey.slice(0, 240),
      status: "in_progress",
      result: {},
    }).onConflictDoNothing().returning();
    if (!execution) {
      outcomes.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }

    const result: Record<string, unknown>[] = [];
    try {
      for (const action of actions) {
        if (action.type === "create_task") {
          const [task] = await db.insert(provisioningTasks).values({
            organizationId: input.organizationId,
            employeeId: input.employeeId,
            kind: action.kind ?? "automation",
            title: action.title,
            owner: action.owner ?? "People Ops",
          }).returning();
          result.push({ type: action.type, taskId: task.id });
          continue;
        }


        if (action.type === "revoke_sessions") {
          if (input.trigger !== "employee.separated") throw new Error("Session revocation automation is allowed only for employee separation.");
          const linkedUsers = await db.select({ id: users.id }).from(users).where(eq(users.employeeId, input.employeeId));
          let revoked = 0;
          for (const linkedUser of linkedUsers) {
            const rows = await db.update(sessions).set({ revokedAt: new Date() })
              .where(and(eq(sessions.userId, linkedUser.id), isNull(sessions.revokedAt)))
              .returning({ id: sessions.id });
            revoked += rows.length;
          }
          result.push({ type: action.type, revoked });
          continue;
        }

        if (action.type === "webhook") {
          const deliveries = await dispatchWebhook({
            organizationId: input.organizationId,
            event: webhookEvent(input.trigger),
            data: {
              employeeId: input.employeeId,
              trigger: input.trigger,
              eventKey: input.eventKey,
              ...input.context,
            },
          });
          result.push({ type: action.type, deliveries });
        }
      }

      await db.update(automationExecutions).set({
        status: "completed",
        result,
        error: null,
      }).where(eq(automationExecutions.id, execution.id));
      outcomes.push({ ruleId: rule.id, status: "completed", result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automation failed.";
      await db.update(automationExecutions).set({
        status: "failed",
        result,
        error: message.slice(0, 4000),
      }).where(eq(automationExecutions.id, execution.id));
      outcomes.push({ ruleId: rule.id, status: "failed", result, error: message });
    }
  }

  return outcomes;
}
