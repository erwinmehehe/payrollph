import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  automationExecutions,
  automationRules,
  benefitPlans,
  orgUnits,
  permissionSets,
  schedulePatterns,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  AUTOMATION_ACTION_CATALOG,
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_LIVE_TRIGGERS,
  AUTOMATION_OPERATORS,
  AUTOMATION_PLANNED_TRIGGERS,
  AUTOMATION_TRIGGER_CATALOG,
  AUTOMATION_TRIGGERS,
  automationTriggerIsLive,
  normalizeAutomationActions,
  validAutomationConditions,
  validateAutomationActionTrigger,
  type AutomationTrigger,
} from "@/lib/automation";
import {
  AUTOMATION_WORKFLOW_TEMPLATES,
  getAutomationWorkflowTemplate,
} from "@/lib/automation-templates";
import {
  AutomationVersionError,
  listAutomationRuleVersions,
  publishAutomationRuleDraft,
  rollbackAutomationRule,
  saveAutomationRuleDraft,
  setAutomationRuleActiveVersioned,
} from "@/lib/automation-versioning";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

function uniqueConstraintViolation(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "23505",
  );
}

async function assertStudioAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide administrators can manage Automation Studio.",
  );
  if (denied) return { denied, access: null };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return {
      denied: Response.json(
        { error: "Automation Studio requires company-wide access." },
        { status: 403 },
      ),
      access: null,
    };
  }
  return { denied: null, access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const guard = await assertStudioAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;

  const [rules, versions, executions, units, sets, plans, patterns] = await Promise.all([
    db.select().from(automationRules)
      .where(eq(automationRules.organizationId, organizationId))
      .orderBy(desc(automationRules.id)),
    listAutomationRuleVersions(organizationId),
    db.select().from(automationExecutions)
      .where(eq(automationExecutions.organizationId, organizationId))
      .orderBy(desc(automationExecutions.id))
      .limit(100),
    db.select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
      .from(orgUnits)
      .where(eq(orgUnits.organizationId, organizationId))
      .orderBy(orgUnits.name),
    db.select({ id: permissionSets.id, name: permissionSets.name, active: permissionSets.active })
      .from(permissionSets)
      .where(eq(permissionSets.organizationId, organizationId))
      .orderBy(permissionSets.name),
    db.select({
      id: benefitPlans.id,
      name: benefitPlans.name,
      category: benefitPlans.category,
      active: benefitPlans.active,
      employeeShare: benefitPlans.employeeShare,
      cap: benefitPlans.cap,
    }).from(benefitPlans)
      .where(eq(benefitPlans.organizationId, organizationId))
      .orderBy(benefitPlans.name),
    db.select({
      id: schedulePatterns.id,
      code: schedulePatterns.code,
      name: schedulePatterns.name,
      cycleDays: schedulePatterns.cycleDays,
      active: schedulePatterns.active,
    }).from(schedulePatterns)
      .where(eq(schedulePatterns.organizationId, organizationId))
      .orderBy(schedulePatterns.name),
  ]);

  const completed = executions.filter((row) => row.status === "completed").length;
  const partial = executions.filter((row) => row.status === "partial").length;
  const failed = executions.filter((row) => row.status === "failed").length;
  const waiting = executions.filter((row) => ["waiting", "waiting_approval", "in_progress"].includes(row.status)).length;
  const terminal = completed + partial + failed;

  return Response.json({
    rules,
    versions,
    executions,
    catalogs: {
      triggers: AUTOMATION_TRIGGER_CATALOG.map((trigger) => ({
        ...trigger,
        live: automationTriggerIsLive(trigger.value),
      })),
      liveTriggers: AUTOMATION_LIVE_TRIGGERS,
      plannedTriggers: AUTOMATION_PLANNED_TRIGGERS,
      conditions: AUTOMATION_CONDITION_FIELDS,
      operators: AUTOMATION_OPERATORS,
      actions: AUTOMATION_ACTION_CATALOG,
      templates: AUTOMATION_WORKFLOW_TEMPLATES.map((template) => ({
        id: template.id,
        version: template.version,
        category: template.category,
        name: template.name,
        description: template.description,
        trigger: template.trigger,
        conditionCount:
          Array.isArray((template.conditions as { all?: unknown[] }).all)
            ? (template.conditions as { all: unknown[] }).all.length
              + (Array.isArray((template.conditions as { any?: unknown[] }).any)
                ? (template.conditions as { any: unknown[] }).any.length
                : 0)
            : 0,
        actionCount: template.actions.length,
      })),
    },
    orgUnits: units,
    permissionSets: sets,
    benefitPlans: plans,
    schedulePatterns: patterns.filter((pattern) => pattern.active),
    analytics: {
      activeRules: rules.filter((row) => row.active).length,
      recentExecutions: executions.length,
      completed,
      partial,
      failed,
      waiting,
      successRate: terminal
        ? Math.round((completed / terminal) * 1000) / 10
        : 100,
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Automation Studio");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const guard = await assertStudioAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "automation-studio-" + (action || "mutation"),
    resourceId: organizationId,
    limit: 40,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create-from-template") {
    const templateId = String(body.templateId ?? "").trim();
    const template = getAutomationWorkflowTemplate(templateId);
    if (!template) {
      return Response.json({ error: "Automation workflow template not found." }, { status: 404 });
    }
    const requestedName = String(body.name ?? template.name).trim();
    if (!requestedName) {
      return Response.json({ error: "Workflow name is required." }, { status: 400 });
    }

    try {
      const result = await saveAutomationRuleDraft({
        organizationId,
        name: requestedName.slice(0, 160),
        trigger: template.trigger,
        conditions: template.conditions,
        actions: template.actions,
        active: true,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio template instantiated as draft",
        resource: result.draft.name,
        metadata: {
          ruleId: result.rule.id,
          draftVersion: result.draft.version,
          templateId: template.id,
          templateVersion: template.version,
          trigger: template.trigger,
          actionTypes: template.actions.map((item) => item.type),
        },
      });
      return Response.json({
        ...result,
        template: {
          id: template.id,
          version: template.version,
          name: template.name,
        },
      }, { status: 201 });
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({
          error: "Another Automation Studio rule already uses this workflow name. Choose a different draft name.",
        }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "save-rule") {
    const id = body.id ? Number(body.id) : null;
    const name = String(body.name ?? "").trim();
    const trigger = String(body.trigger ?? "") as AutomationTrigger;
    const conditions = body.conditions ?? { version: 1, all: [], any: [] };
    const actions = normalizeAutomationActions(body.actions);
    const desiredActive = body.active === undefined ? true : Boolean(body.active);

    if (
      !name
      || !(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger)
      || !validAutomationConditions(conditions)
      || !actions
    ) {
      return Response.json({
        error: "Rule name, supported trigger, valid IF conditions, and at least one valid THEN action are required.",
      }, { status: 400 });
    }
    if (!automationTriggerIsLive(trigger)) {
      return Response.json({
        error: "This trigger is visible on the Automation Studio roadmap but its authoritative event adapter is not connected yet.",
        trigger,
      }, { status: 409 });
    }

    const compatibilityError = validateAutomationActionTrigger(trigger, actions);
    if (compatibilityError) return Response.json({ error: compatibilityError }, { status: 400 });

    try {
      const result = await saveAutomationRuleDraft({
        organizationId,
        ruleId: id,
        name: name.slice(0, 160),
        trigger,
        conditions,
        actions,
        active: desiredActive,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: result.created ? "Automation Studio draft created" : "Automation Studio draft updated",
        resource: result.draft.name,
        metadata: {
          ruleId: result.rule.id,
          draftVersion: result.draft.version,
          publishedVersion: result.rule.publishedVersion,
          trigger,
          actionTypes: actions.map((item) => item.type),
        },
      });
      return Response.json(result, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another Automation Studio rule already uses this workflow name." }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "publish-rule") {
    const ruleId = Number(body.ruleId);
    if (!Number.isInteger(ruleId)) return Response.json({ error: "ruleId is required." }, { status: 400 });
    try {
      const result = await publishAutomationRuleDraft({
        organizationId,
        ruleId,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio draft published",
        resource: result.rule.name,
        metadata: {
          ruleId,
          publishedVersion: result.published.version,
          trigger: result.rule.trigger,
          active: result.rule.active,
        },
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another Automation Studio rule already uses this workflow name." }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "rollback-rule") {
    const ruleId = Number(body.ruleId);
    const targetVersion = Number(body.targetVersion);
    if (!Number.isInteger(ruleId) || !Number.isInteger(targetVersion)) {
      return Response.json({ error: "ruleId and targetVersion are required." }, { status: 400 });
    }
    try {
      const result = await rollbackAutomationRule({
        organizationId,
        ruleId,
        targetVersion,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio rule rolled back",
        resource: result.rule.name,
        metadata: {
          ruleId,
          restoredFromVersion: result.restoredFromVersion,
          publishedVersion: result.published.version,
          trigger: result.rule.trigger,
          active: result.rule.active,
        },
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another Automation Studio rule already uses this workflow name." }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "set-active") {
    const ruleId = Number(body.ruleId);
    const active = Boolean(body.active);
    if (!Number.isInteger(ruleId)) {
      return Response.json({ error: "ruleId is required." }, { status: 400 });
    }

    try {
      const result = await setAutomationRuleActiveVersioned({
        organizationId,
        ruleId,
        active,
        actorUserId: user.id,
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: active ? "Automation Studio rule enabled" : "Automation Studio rule disabled",
        resource: result.rule.name,
        metadata: {
          ruleId: result.rule.id,
          trigger: result.rule.trigger,
          publishedVersion: result.rule.publishedVersion,
        },
      });
      return Response.json(result);
    } catch (error) {
      if (error instanceof AutomationVersionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another Automation Studio rule already uses this workflow name." }, { status: 409 });
      }
      throw error;
    }
  }

  return Response.json({ error: "Unsupported Automation Studio action." }, { status: 400 });
}
