import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities, userEntityPreferences, userLegalEntityGrants } from "@/db/schema";
import { getAccess } from "@/lib/access";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { decideEntityAccess, entityResourceAllowed, GROUP_ENTITY_ROLES } from "@/lib/multi-entity-policy";

export type MultiEntityContext = {
  enabled: boolean;
  group: boolean;
  legalEntityId: number | null;
  organizationId: number;
  role: string;
  entities: Array<{ id: number; legalName: string; displayName: string; code: string }>;
};
export type EntityResult = { ok: true; context: MultiEntityContext } | { ok: false; response: Response };

const denied = (message = "Legal employer is not available to this account.") =>
  Response.json({ error: message, code: "ENTITY_ACCESS_DENIED" }, { status: 403 });

/** No reads from the new tables while the release flag is off. */
export async function resolveMultiEntityContext(input: {
  userId: number;
  organizationId: number;
  request?: Request;
  requested?: string | number | null;
}): Promise<EntityResult> {
  const access = await getAccess(input.userId, input.organizationId);
  if (!access || access.role === "employee")
    return { ok: false, response: denied("No company membership in this organization.") };

  if (!criticalReleaseFlagEnabled("multiEntity")) {
    return { ok: true, context: {
      enabled: false, group: access.companyWide, legalEntityId: null,
      organizationId: input.organizationId, role: access.role, entities: [],
    } };
  }

  const [entities, grants, preference] = await Promise.all([
    db.select({ id: legalEntities.id, legalName: legalEntities.legalName,
      displayName: legalEntities.displayName, code: legalEntities.code })
      .from(legalEntities).where(and(
        eq(legalEntities.organizationId, input.organizationId),
        eq(legalEntities.active, true),
      )).orderBy(asc(legalEntities.id)),
    db.select({ legalEntityId: userLegalEntityGrants.legalEntityId })
      .from(userLegalEntityGrants).where(and(
        eq(userLegalEntityGrants.organizationId, input.organizationId),
        eq(userLegalEntityGrants.userId, input.userId),
      )),
    db.select({ legalEntityId: userEntityPreferences.legalEntityId })
      .from(userEntityPreferences).where(and(
        eq(userEntityPreferences.organizationId, input.organizationId),
        eq(userEntityPreferences.userId, input.userId),
      )).limit(1),
  ]);
  const explicit = input.requested !== undefined
    ? input.requested
    : input.request?.headers.get("x-legal-entity-id")
      ?? new URL(input.request?.url ?? "https://invalid.local/").searchParams.get("legalEntityId")
      ?? undefined;
  const requested = explicit !== undefined
    ? explicit : preference[0]
      ? (preference[0].legalEntityId ?? "all") : undefined;
  const decision = decideEntityAccess({
    role: access.role,
    availableEntityIds: entities.map(entity => entity.id),
    grantedEntityIds: grants.map(grant => grant.legalEntityId),
    requested,
  });
  if (!decision.ok) return { ok: false, response: denied(
    decision.code === "ENTITY_SELECTION_REQUIRED"
      ? "An administrator must assign exactly one legal employer to this role."
      : undefined,
  ) };
  return { ok: true, context: {
    enabled: true, group: decision.group,
    legalEntityId: decision.selectedEntityId,
    organizationId: input.organizationId, role: access.role,
    entities: decision.group
      ? entities
      : entities.filter(entity => entity.id === decision.selectedEntityId),
  } };
}

/** Resource-ID routes MUST authorize the run/employee/file's actual employer. */
export function assertEntityResource(
  context: MultiEntityContext, resourceEntityId: number | null | undefined,
): Response | null {
  if (!context.enabled) return null;
  const decision = context.legalEntityId === null
    ? { ok: true as const, group: context.group, selectedEntityId: null }
    : { ok: true as const, group: context.group, selectedEntityId: context.legalEntityId };
  if (entityResourceAllowed(decision, resourceEntityId ?? null)) return null;
  return denied();
}

export function entityWhereRequired(context: MultiEntityContext): number | null {
  return context.enabled ? context.legalEntityId : null;
}

export function canReadGroupReport(context: MultiEntityContext): boolean {
  return context.enabled && context.group && GROUP_ENTITY_ROLES.has(context.role);
}
