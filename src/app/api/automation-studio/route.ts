import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  automationExecutions,
  automationRules,
  automationRuleVersions,
  benefitPlans,
  orgUnits,
  permissionSets,
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
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

class AutomationStudioMutationError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "AutomationStudioMutationError";
    this.status = status;
  }
}

function normalizeRuleDefinition(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim();
  const trigger = String(body.trigger ?? "") as AutomationTrigger;
  const conditions = body.conditions ?? { version: 1, all: [], any: [] };
  const actions = normalizeAutomationActions(body.actions);

  if (
    !name
    || !(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger)
    || !validAutomationConditions(conditions)
    || !actions
  ) {
    throw new AutomationStudioMutationError(
      "Rule name, supported trigger, valid IF conditions, and at least one valid THEN action are required.",
      400,
    );
  }
  if (!automationTriggerIsLive(trigger)) {
    throw new AutomationStudioMutationError(
      "This trigger is visible on the Automation Studio roadmap but its authoritative event adapter is not connected yet.",
      409,
    );
  }
  const compatibilityError = validateAutomationActionTrigger(trigger, actions);
  if (compatibilityError) {
    throw new AutomationStudioMutationError(compatibilityError, 400);
  }

  return {
    name: name.slice(0, 160),
    trigger,
    conditions,
    actions,
  };
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

  const [rules, executions, units, sets, plans, ruleVersions] = await Promise.all([
    db.select().from(automationRules)
      .where(eq(automationRules.organizationId, organizationId))
      .orderBy(desc(automationRules.id)),
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
    db.select().from(automationRuleVersions)
      .where(eq(automationRuleVersions.organizationId, organizationId))
      .orderBy(desc(automationRuleVersions.ruleId), desc(automationRuleVersions.version))
      .limit(500),
  ]);

  const completed = executions.filter((row) => row.status === "completed").length;
  const partial = executions.filter((row) => row.status === "partial").length;
  const failed = executions.filter((row) => row.status === "failed").length;
  const waiting = executions.filter((row) => ["waiting", "waiting_approval", "in_progress"].includes(row.status)).length;
  const terminal = completed + partial + failed;

  return Response.json({
    rules,
    ruleVersions,
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
    },
    orgUnits: units,
    permissionSets: sets,
    benefitPlans: plans,
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

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
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

  if (action === "save-rule") {
    try {
      const definition = normalizeRuleDefinition(body);
      const id = body.id ? Number(body.id) : null;
      const now = new Date();

      if (id) {
        if (!Number.isInteger(id)) {
          return Response.json({ error: "A valid rule id is required." }, { status: 400 });
        }

        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`
            select id
            from automation_rules
            where id = ${id}
              and organization_id = ${organizationId}
            for update
          `);

          const [current] = await tx.select().from(automationRules).where(and(
            eq(automationRules.id, id),
            eq(automationRules.organizationId, organizationId),
          )).limit(1);
          if (!current) {
            throw new AutomationStudioMutationError("Automation rule not found.", 404);
          }

          const [latest] = await tx.select({ version: automationRuleVersions.version })
            .from(automationRuleVersions)
            .where(and(
              eq(automationRuleVersions.organizationId, organizationId),
              eq(automationRuleVersions.ruleId, id),
            ))
            .orderBy(desc(automationRuleVersions.version))
            .limit(1);
          const nextVersion = (latest?.version ?? 0) + 1;

          await tx.insert(automationRuleVersions).values({
            organizationId,
            ruleId: id,
            version: nextVersion,
            name: definition.name,
            trigger: definition.trigger,
            conditions: definition.conditions,
            actions: definition.actions,
            createdByUserId: user.id,
            createdByName: user.name,
            createdAt: now,
          });

          const [row] = await tx.update(automationRules).set({
            name: definition.name,
            trigger: definition.trigger,
            conditions: definition.conditions,
            actions: definition.actions,
            active: body.active === undefined ? current.active : Boolean(body.active),
            publishedVersion: nextVersion,
            draftVersion: null,
            publishedAt: now,
            publishedByUserId: user.id,
            updatedAt: now,
          }).where(and(
            eq(automationRules.id, id),
            eq(automationRules.organizationId, organizationId),
          )).returning();

          return { row, version: nextVersion, previousVersion: current.publishedVersion };
        });

        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: "Automation Studio rule updated and published",
          resource: result.row.name,
          metadata: {
            ruleId: result.row.id,
            fromVersion: result.previousVersion,
            publishedVersion: result.version,
            trigger: result.row.trigger,
          },
        });
        return Response.json({ ...result.row, version: result.version });
      }

      const result = await db.transaction(async (tx) => {
        const [row] = await tx.insert(automationRules).values({
          organizationId,
          name: definition.name,
          trigger: definition.trigger,
          conditions: definition.conditions,
          actions: definition.actions,
          active: body.active === undefined ? true : Boolean(body.active),
          publishedVersion: 1,
          draftVersion: null,
          publishedAt: now,
          publishedByUserId: user.id,
          createdByUserId: user.id,
          createdAt: now,
          updatedAt: now,
        }).returning();

        await tx.insert(automationRuleVersions).values({
          organizationId,
          ruleId: row.id,
          version: 1,
          name: definition.name,
          trigger: definition.trigger,
          conditions: definition.conditions,
          actions: definition.actions,
          createdByUserId: user.id,
          createdByName: user.name,
          createdAt: now,
        });

        return row;
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio rule created and published",
        resource: result.name,
        metadata: {
          ruleId: result.id,
          publishedVersion: 1,
          trigger: result.trigger,
          actionTypes: definition.actions.map((item) => item.type),
        },
      });
      return Response.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof AutomationStudioMutationError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      return Response.json({
        error: "Automation rule could not be saved. Confirm the workflow name is unique and try again.",
      }, { status: 409 });
    }
  }

  if (action === "save-draft") {
    const ruleId = Number(body.ruleId);
    if (!Number.isInteger(ruleId)) {
      return Response.json({ error: "ruleId is required." }, { status: 400 });
    }

    try {
      const definition = normalizeRuleDefinition(body);
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`
          select id
          from automation_rules
          where id = ${ruleId}
            and organization_id = ${organizationId}
          for update
        `);
        const [current] = await tx.select().from(automationRules).where(and(
          eq(automationRules.id, ruleId),
          eq(automationRules.organizationId, organizationId),
        )).limit(1);
        if (!current) {
          throw new AutomationStudioMutationError("Automation rule not found.", 404);
        }

        const [latest] = await tx.select({ version: automationRuleVersions.version })
          .from(automationRuleVersions)
          .where(and(
            eq(automationRuleVersions.organizationId, organizationId),
            eq(automationRuleVersions.ruleId, ruleId),
          ))
          .orderBy(desc(automationRuleVersions.version))
          .limit(1);
        const nextVersion = (latest?.version ?? 0) + 1;

        const [version] = await tx.insert(automationRuleVersions).values({
          organizationId,
          ruleId,
          version: nextVersion,
          name: definition.name,
          trigger: definition.trigger,
          conditions: definition.conditions,
          actions: definition.actions,
          createdByUserId: user.id,
          createdByName: user.name,
          createdAt: now,
        }).returning();

        const [row] = await tx.update(automationRules).set({
          draftVersion: nextVersion,
          updatedAt: now,
        }).where(and(
          eq(automationRules.id, ruleId),
          eq(automationRules.organizationId, organizationId),
        )).returning();

        return { row, version };
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio draft staged",
        resource: result.row.name,
        metadata: {
          ruleId,
          draftVersion: result.version.version,
          publishedVersion: result.row.publishedVersion,
          trigger: result.version.trigger,
        },
      });
      return Response.json({ rule: result.row, version: result.version });
    } catch (error) {
      if (error instanceof AutomationStudioMutationError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      return Response.json({ error: "Automation draft could not be staged." }, { status: 409 });
    }
  }

  if (action === "publish-draft") {
    const ruleId = Number(body.ruleId);
    if (!Number.isInteger(ruleId)) {
      return Response.json({ error: "ruleId is required." }, { status: 400 });
    }

    try {
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`
          select id
          from automation_rules
          where id = ${ruleId}
            and organization_id = ${organizationId}
          for update
        `);
        const [current] = await tx.select().from(automationRules).where(and(
          eq(automationRules.id, ruleId),
          eq(automationRules.organizationId, organizationId),
        )).limit(1);
        if (!current) {
          throw new AutomationStudioMutationError("Automation rule not found.", 404);
        }
        if (!current.draftVersion) {
          throw new AutomationStudioMutationError("This automation rule has no staged draft.");
        }

        const [version] = await tx.select().from(automationRuleVersions).where(and(
          eq(automationRuleVersions.organizationId, organizationId),
          eq(automationRuleVersions.ruleId, ruleId),
          eq(automationRuleVersions.version, current.draftVersion),
        )).limit(1);
        if (!version) {
          throw new AutomationStudioMutationError("The staged automation version could not be found.");
        }

        const definition = normalizeRuleDefinition({
          name: version.name,
          trigger: version.trigger,
          conditions: version.conditions,
          actions: version.actions,
        });

        const [row] = await tx.update(automationRules).set({
          name: definition.name,
          trigger: definition.trigger,
          conditions: definition.conditions,
          actions: definition.actions,
          publishedVersion: version.version,
          draftVersion: null,
          publishedAt: now,
          publishedByUserId: user.id,
          updatedAt: now,
        }).where(and(
          eq(automationRules.id, ruleId),
          eq(automationRules.organizationId, organizationId),
        )).returning();

        return { row, version, previousVersion: current.publishedVersion };
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio draft published",
        resource: result.row.name,
        metadata: {
          ruleId,
          fromVersion: result.previousVersion,
          publishedVersion: result.version.version,
          trigger: result.row.trigger,
        },
      });
      return Response.json({ rule: result.row, version: result.version });
    } catch (error) {
      if (error instanceof AutomationStudioMutationError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      return Response.json({ error: "Automation draft could not be published." }, { status: 409 });
    }
  }

  if (action === "discard-draft") {
    const ruleId = Number(body.ruleId);
    if (!Number.isInteger(ruleId)) {
      return Response.json({ error: "ruleId is required." }, { status: 400 });
    }

    const [current] = await db.select().from(automationRules).where(and(
      eq(automationRules.id, ruleId),
      eq(automationRules.organizationId, organizationId),
    )).limit(1);
    if (!current) return Response.json({ error: "Automation rule not found." }, { status: 404 });
    if (!current.draftVersion) {
      return Response.json({ error: "This automation rule has no staged draft." }, { status: 409 });
    }

    const [row] = await db.update(automationRules).set({
      draftVersion: null,
      updatedAt: new Date(),
    }).where(and(
      eq(automationRules.id, ruleId),
      eq(automationRules.organizationId, organizationId),
      eq(automationRules.draftVersion, current.draftVersion),
    )).returning();
    if (!row) {
      return Response.json({ error: "The staged draft changed before it could be discarded." }, { status: 409 });
    }

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Automation Studio draft discarded",
      resource: row.name,
      metadata: { ruleId, discardedVersion: current.draftVersion },
    });
    return Response.json(row);
  }

  if (action === "rollback-rule") {
    const ruleId = Number(body.ruleId);
    const targetVersion = Number(body.targetVersion);
    if (!Number.isInteger(ruleId) || !Number.isInteger(targetVersion) || targetVersion <= 0) {
      return Response.json({ error: "ruleId and a positive targetVersion are required." }, { status: 400 });
    }

    try {
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`
          select id
          from automation_rules
          where id = ${ruleId}
            and organization_id = ${organizationId}
          for update
        `);
        const [current] = await tx.select().from(automationRules).where(and(
          eq(automationRules.id, ruleId),
          eq(automationRules.organizationId, organizationId),
        )).limit(1);
        if (!current) {
          throw new AutomationStudioMutationError("Automation rule not found.", 404);
        }
        if (current.publishedVersion === targetVersion) {
          throw new AutomationStudioMutationError("That version is already published.");
        }

        const [version] = await tx.select().from(automationRuleVersions).where(and(
          eq(automationRuleVersions.organizationId, organizationId),
          eq(automationRuleVersions.ruleId, ruleId),
          eq(automationRuleVersions.version, targetVersion),
        )).limit(1);
        if (!version) {
          throw new AutomationStudioMutationError("Automation rule version not found.", 404);
        }

        const definition = normalizeRuleDefinition({
          name: version.name,
          trigger: version.trigger,
          conditions: version.conditions,
          actions: version.actions,
        });

        const [row] = await tx.update(automationRules).set({
          name: definition.name,
          trigger: definition.trigger,
          conditions: definition.conditions,
          actions: definition.actions,
          publishedVersion: targetVersion,
          draftVersion: null,
          publishedAt: now,
          publishedByUserId: user.id,
          updatedAt: now,
        }).where(and(
          eq(automationRules.id, ruleId),
          eq(automationRules.organizationId, organizationId),
        )).returning();

        return { row, version, previousVersion: current.publishedVersion };
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Automation Studio rule rolled back",
        resource: result.row.name,
        metadata: {
          ruleId,
          fromVersion: result.previousVersion,
          targetVersion,
          trigger: result.row.trigger,
        },
      });
      return Response.json({ rule: result.row, version: result.version });
    } catch (error) {
      if (error instanceof AutomationStudioMutationError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      return Response.json({ error: "Automation rule could not be rolled back." }, { status: 409 });
    }
  }

  if (action === "set-active") {
    const ruleId = Number(body.ruleId);
    const active = Boolean(body.active);
    if (!Number.isInteger(ruleId)) {
      return Response.json({ error: "ruleId is required." }, { status: 400 });
    }

    const [row] = await db.update(automationRules).set({
      active,
      updatedAt: new Date(),
    }).where(and(
      eq(automationRules.id, ruleId),
      eq(automationRules.organizationId, organizationId),
    )).returning();

    if (!row) return Response.json({ error: "Automation rule not found." }, { status: 404 });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: active ? "Automation Studio rule enabled" : "Automation Studio rule disabled",
      resource: row.name,
      metadata: { ruleId: row.id, trigger: row.trigger },
    });
    return Response.json(row);
  }

  return Response.json({ error: "Unsupported Automation Studio action." }, { status: 400 });
}
