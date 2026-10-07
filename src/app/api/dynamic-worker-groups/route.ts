import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { automationRules, dynamicWorkerGroups } from "@/db/schema";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  DYNAMIC_WORKER_GROUP_FIELDS,
  DYNAMIC_WORKER_GROUP_OPERATORS,
  listDynamicWorkerGroups,
  normalizeDynamicGroupCode,
  previewDynamicWorkerGroup,
  validDynamicWorkerGroupConditions,
} from "@/lib/dynamic-worker-groups";
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

function conditionsReferenceDynamicGroup(value: unknown, code: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  for (const bucket of ["all", "any"] as const) {
    const clauses = Array.isArray(row[bucket]) ? row[bucket] as Array<Record<string, unknown>> : [];
    for (const clause of clauses) {
      if (String(clause.field ?? "") !== "dynamicGroupCodes") continue;
      const operator = String(clause.operator ?? "");
      const values = operator === "in"
        ? (Array.isArray(clause.value) ? clause.value : [])
        : [clause.value];
      if (values.some((value) => String(value ?? "") === code)) return true;
    }
  }
  return false;
}

function workflowStepsReferenceDynamicGroup(value: unknown, code: string): boolean {
  if (!Array.isArray(value)) return false;
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const step = raw as Record<string, unknown>;
    if (String(step.type ?? "") !== "branch") continue;
    if (conditionsReferenceDynamicGroup(step.conditions, code)) return true;
    if (workflowStepsReferenceDynamicGroup(step.then, code)) return true;
    if (workflowStepsReferenceDynamicGroup(step.else, code)) return true;
  }
  return false;
}

function ruleReferencesDynamicGroup(
  rule: { conditions: unknown; actions: unknown },
  code: string,
) {
  return conditionsReferenceDynamicGroup(rule.conditions, code)
    || workflowStepsReferenceDynamicGroup(rule.actions, code);
}

async function dynamicGroupDependencies(organizationId: number, code: string) {
  const rules = await db.select({
    id: automationRules.id,
    name: automationRules.name,
    active: automationRules.active,
    conditions: automationRules.conditions,
    actions: automationRules.actions,
  }).from(automationRules).where(eq(automationRules.organizationId, organizationId));
  return rules
    .filter((rule) => ruleReferencesDynamicGroup(rule, code))
    .map((rule) => ({ id: rule.id, name: rule.name, active: rule.active }));
}

async function assertGroupAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide administrators can manage Dynamic Groups.",
  );
  if (denied) return { denied, access: null };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return {
      denied: Response.json(
        { error: "Dynamic Groups require company-wide access." },
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

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const guard = await assertGroupAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;

  const previewGroupId = Number(url.searchParams.get("previewGroupId"));
  if (Number.isInteger(previewGroupId) && previewGroupId > 0) {
    const [group] = await db.select().from(dynamicWorkerGroups).where(eq(dynamicWorkerGroups.id, previewGroupId)).limit(1);
    if (!group || group.organizationId !== organizationId) {
      return Response.json({ error: "Dynamic group not found." }, { status: 404 });
    }
    if (!validDynamicWorkerGroupConditions(group.conditions)) {
      return Response.json({ error: "Dynamic group definition is invalid." }, { status: 409 });
    }
    const preview = await previewDynamicWorkerGroup({
      organizationId,
      conditions: group.conditions,
      limit: 50,
    });
    return Response.json({
      group: {
        id: group.id,
        code: group.code,
        name: group.name,
        version: group.version,
        active: group.active,
      },
      preview,
      generatedAt: new Date().toISOString(),
    });
  }

  const groups = await listDynamicWorkerGroups(organizationId);
  const dependencyPairs = await Promise.all(groups.map(async (group) => ({
    groupId: group.id,
    dependencies: await dynamicGroupDependencies(organizationId, group.code),
  })));
  const dependenciesByGroup = new Map(dependencyPairs.map((row) => [row.groupId, row.dependencies]));
  return Response.json({
    groups: groups.map((group) => {
      const dependencies = dependenciesByGroup.get(group.id) ?? [];
      return {
        ...group,
        automationDependencyCount: dependencies.length,
        activeAutomationDependencyCount: dependencies.filter((dependency) => dependency.active).length,
        automationDependencies: dependencies,
      };
    }),
    catalogs: {
      fields: DYNAMIC_WORKER_GROUP_FIELDS,
      operators: DYNAMIC_WORKER_GROUP_OPERATORS,
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Dynamic Groups");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const guard = await assertGroupAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "dynamic-worker-groups-" + (action || "mutation"),
    resourceId: organizationId,
    limit: 40,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "save-group") {
    const id = body.id == null ? null : Number(body.id);
    const name = String(body.name ?? "").trim();
    const code = normalizeDynamicGroupCode(String(body.code ?? name));
    const description = String(body.description ?? "").trim();
    const conditions = body.conditions;

    if (!name || !code || !validDynamicWorkerGroupConditions(conditions)) {
      return Response.json({
        error: "Group name, code, and at least one valid live-worker condition are required.",
      }, { status: 400 });
    }

    try {
      if (id != null) {
        if (!Number.isInteger(id) || id < 1) {
          return Response.json({ error: "Invalid dynamic group id." }, { status: 400 });
        }
        const [existing] = await db.select().from(dynamicWorkerGroups)
          .where(eq(dynamicWorkerGroups.id, id))
          .limit(1);
        if (!existing || existing.organizationId !== organizationId) {
          return Response.json({ error: "Dynamic group not found." }, { status: 404 });
        }

        const definitionChanged = JSON.stringify(existing.conditions) !== JSON.stringify(conditions);
        if (definitionChanged) {
          const dependencies = await dynamicGroupDependencies(organizationId, existing.code);
          const activeDependencies = dependencies.filter((dependency) => dependency.active);
          if (activeDependencies.length > 0) {
            return Response.json({
              error: "This live Dynamic Group is used by active Automation Studio workflows. Disable those workflows before changing group membership logic.",
              dependencies: activeDependencies,
            }, { status: 409 });
          }
        }

        const [group] = await db.update(dynamicWorkerGroups).set({
          name: name.slice(0, 160),
          code: existing.code,
          description: description ? description.slice(0, 500) : null,
          conditions,
          version: existing.version + 1,
          updatedAt: new Date(),
        }).where(eq(dynamicWorkerGroups.id, id)).returning();

        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: "Dynamic worker group updated",
          resource: group.name,
          metadata: {
            groupId: group.id,
            code: group.code,
            previousVersion: existing.version,
            version: group.version,
            conditions: group.conditions,
          },
        });
        return Response.json({ group });
      }

      const [group] = await db.insert(dynamicWorkerGroups).values({
        organizationId,
        name: name.slice(0, 160),
        code,
        description: description ? description.slice(0, 500) : null,
        conditions,
        version: 1,
        active: true,
        createdByUserId: user.id,
        createdByName: user.name,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Dynamic worker group created",
        resource: group.name,
        metadata: {
          groupId: group.id,
          code: group.code,
          version: group.version,
          conditions: group.conditions,
        },
      });
      return Response.json({ group }, { status: 201 });
    } catch (error) {
      if (uniqueConstraintViolation(error)) {
        return Response.json({ error: "Another dynamic group already uses this code." }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "set-active") {
    const id = Number(body.id);
    const active = Boolean(body.active);
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "Dynamic group id is required." }, { status: 400 });
    }
    const [existing] = await db.select().from(dynamicWorkerGroups)
      .where(eq(dynamicWorkerGroups.id, id))
      .limit(1);
    if (!existing || existing.organizationId !== organizationId) {
      return Response.json({ error: "Dynamic group not found." }, { status: 404 });
    }

    if (!active) {
      const dependencies = await dynamicGroupDependencies(organizationId, existing.code);
      const activeDependencies = dependencies.filter((dependency) => dependency.active);
      if (activeDependencies.length > 0) {
        return Response.json({
          error: "Disable dependent Automation Studio workflows before disabling this Dynamic Group.",
          dependencies: activeDependencies,
        }, { status: 409 });
      }
    }

    const [group] = await db.update(dynamicWorkerGroups).set({
      active,
      version: existing.version + 1,
      updatedAt: new Date(),
    }).where(eq(dynamicWorkerGroups.id, id)).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: active ? "Dynamic worker group enabled" : "Dynamic worker group disabled",
      resource: group.name,
      metadata: {
        groupId: group.id,
        code: group.code,
        previousVersion: existing.version,
        version: group.version,
      },
    });
    return Response.json({ group });
  }

  return Response.json({ error: "Unsupported Dynamic Groups action." }, { status: 400 });
}
