import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { hcmBusinessProcessDefinitions, orgUnits } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  HCM_BUSINESS_PROCESS_TYPES,
  validateHcmBusinessProcessSteps,
} from "@/lib/hcm-business-process";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

function isoDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function assertBusinessProcessAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can configure HCM business processes.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return { error: Response.json({
      error: "HCM business-process administration requires company-wide People access.",
    }, { status: 403 }) };
  }
  return { access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await assertBusinessProcessAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const [definitions, supervisoryOrganizations] = await Promise.all([
    db.select().from(hcmBusinessProcessDefinitions)
      .where(eq(hcmBusinessProcessDefinitions.organizationId, organizationId))
      .orderBy(hcmBusinessProcessDefinitions.processType, hcmBusinessProcessDefinitions.code),
    db.select({
      id: orgUnits.id,
      parentId: orgUnits.parentId,
      code: orgUnits.code,
      name: orgUnits.name,
      managerEmployeeId: orgUnits.managerEmployeeId,
      active: orgUnits.active,
    }).from(orgUnits).where(and(
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.type, "supervisory"),
    )).orderBy(orgUnits.name),
  ]);

  return Response.json({
    definitions,
    supervisoryOrganizations,
    processTypes: HCM_BUSINESS_PROCESS_TYPES,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "HCM business processes");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const gate = await assertBusinessProcessAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "hcm-business-process-definition",
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const action = String(body.action ?? "save").trim().toLowerCase();
  if (action === "set-active") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      return Response.json({ error: "A valid definition id is required." }, { status: 400 });
    }
    const [existing] = await db.select().from(hcmBusinessProcessDefinitions).where(and(
      eq(hcmBusinessProcessDefinitions.id, id),
      eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Business-process definition not found." }, { status: 404 });

    const nextActive = Boolean(body.active);
    const scopeCondition = existing.supervisoryOrgUnitId == null
      ? isNull(hcmBusinessProcessDefinitions.supervisoryOrgUnitId)
      : eq(hcmBusinessProcessDefinitions.supervisoryOrgUnitId, existing.supervisoryOrgUnitId);

    const [updated] = await db.transaction(async (tx) => {
      if (nextActive) {
        await tx.update(hcmBusinessProcessDefinitions).set({
          active: false,
          updatedAt: new Date(),
        }).where(and(
          eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
          eq(hcmBusinessProcessDefinitions.processType, existing.processType),
          scopeCondition,
          ne(hcmBusinessProcessDefinitions.id, existing.id),
          eq(hcmBusinessProcessDefinitions.active, true),
        ));
      }
      return tx.update(hcmBusinessProcessDefinitions).set({
        active: nextActive,
        updatedAt: new Date(),
      }).where(eq(hcmBusinessProcessDefinitions.id, existing.id)).returning();
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: updated.active ? "HCM business process enabled" : "HCM business process disabled",
      resource: updated.name,
      metadata: {
        definitionId: updated.id,
        code: updated.code,
        processType: updated.processType,
        supervisoryOrgUnitId: updated.supervisoryOrgUnitId,
        version: updated.version,
      },
    });
    return Response.json(updated);
  }

  if (action !== "save") {
    return Response.json({ error: "Unsupported HCM business-process action." }, { status: 400 });
  }

  const id = body.id == null || body.id === "" ? null : Number(body.id);
  const code = String(body.code ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const processType = String(body.processType ?? "").trim().toLowerCase();
  const effectiveFrom = String(body.effectiveFrom ?? "").trim();
  const effectiveUntil = body.effectiveUntil == null || body.effectiveUntil === ""
    ? null
    : String(body.effectiveUntil).trim();
  const supervisoryOrgUnitId = body.supervisoryOrgUnitId == null || body.supervisoryOrgUnitId === ""
    ? null
    : Number(body.supervisoryOrgUnitId);
  const steps = validateHcmBusinessProcessSteps(body.steps);

  if (id !== null && !Number.isInteger(id)) {
    return Response.json({ error: "Definition id must be a valid integer." }, { status: 400 });
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/.test(code)) {
    return Response.json({ error: "Definition code must contain 3-64 lowercase letters, numbers, hyphens or underscores." }, { status: 400 });
  }
  if (!name || name.length > 160) {
    return Response.json({ error: "A business-process name is required." }, { status: 400 });
  }
  if (!HCM_BUSINESS_PROCESS_TYPES.includes(processType as (typeof HCM_BUSINESS_PROCESS_TYPES)[number])) {
    return Response.json({ error: "Unsupported HCM business-process type." }, { status: 400 });
  }
  if (!isoDate(effectiveFrom) || (effectiveUntil !== null && !isoDate(effectiveUntil))) {
    return Response.json({ error: "Effective dates must use YYYY-MM-DD." }, { status: 400 });
  }
  if (effectiveUntil && effectiveUntil < effectiveFrom) {
    return Response.json({ error: "effectiveUntil cannot be earlier than effectiveFrom." }, { status: 400 });
  }
  if (!steps) {
    return Response.json({ error: "Provide 1-12 valid approval, review, or to-do steps." }, { status: 400 });
  }

  if (supervisoryOrgUnitId !== null) {
    if (!Number.isInteger(supervisoryOrgUnitId)) {
      return Response.json({ error: "supervisoryOrgUnitId must be a valid id." }, { status: 400 });
    }
    const [scope] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, supervisoryOrgUnitId),
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.type, "supervisory"),
      eq(orgUnits.active, true),
    )).limit(1);
    if (!scope) {
      return Response.json({ error: "The selected supervisory organization is not active in this workspace." }, { status: 400 });
    }
  }

  const scopeCondition = supervisoryOrgUnitId === null
    ? isNull(hcmBusinessProcessDefinitions.supervisoryOrgUnitId)
    : eq(hcmBusinessProcessDefinitions.supervisoryOrgUnitId, supervisoryOrgUnitId);

  if (id !== null) {
    const [existing] = await db.select().from(hcmBusinessProcessDefinitions).where(and(
      eq(hcmBusinessProcessDefinitions.id, id),
      eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Business-process definition not found." }, { status: 404 });

    const [updated] = await db.transaction(async (tx) => {
      await tx.update(hcmBusinessProcessDefinitions).set({
        active: false,
        updatedAt: new Date(),
      }).where(and(
        eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
        eq(hcmBusinessProcessDefinitions.processType, processType),
        scopeCondition,
        ne(hcmBusinessProcessDefinitions.id, id),
        eq(hcmBusinessProcessDefinitions.active, true),
      ));

      return tx.update(hcmBusinessProcessDefinitions).set({
        code,
        name: name.slice(0, 160),
        processType,
        supervisoryOrgUnitId,
        version: existing.version + 1,
        effectiveFrom,
        effectiveUntil,
        steps,
        active: true,
        updatedAt: new Date(),
      }).where(eq(hcmBusinessProcessDefinitions.id, id)).returning();
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM business process revised",
      resource: updated.name,
      metadata: {
        definitionId: updated.id,
        code: updated.code,
        processType: updated.processType,
        supervisoryOrgUnitId: updated.supervisoryOrgUnitId,
        version: updated.version,
        stepCount: steps.length,
      },
    });
    return Response.json(updated);
  }

  try {
    const [created] = await db.transaction(async (tx) => {
      await tx.update(hcmBusinessProcessDefinitions).set({
        active: false,
        updatedAt: new Date(),
      }).where(and(
        eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
        eq(hcmBusinessProcessDefinitions.processType, processType),
        scopeCondition,
        eq(hcmBusinessProcessDefinitions.active, true),
      ));

      return tx.insert(hcmBusinessProcessDefinitions).values({
        organizationId,
        code,
        name: name.slice(0, 160),
        processType,
        supervisoryOrgUnitId,
        version: 1,
        effectiveFrom,
        effectiveUntil,
        steps,
        active: true,
        createdByUserId: user.id,
      }).returning();
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM business process created",
      resource: created.name,
      metadata: {
        definitionId: created.id,
        code: created.code,
        processType: created.processType,
        supervisoryOrgUnitId: created.supervisoryOrgUnitId,
        version: created.version,
        stepCount: steps.length,
      },
    });
    return Response.json(created, { status: 201 });
  } catch {
    return Response.json({ error: "A business-process definition with this code already exists." }, { status: 409 });
  }
}
