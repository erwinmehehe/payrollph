import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities, userEntityPreferences, userLegalEntityGrants } from "@/db/schema";
import { getAccess } from "@/lib/access";
import { assertOrganizationSessionPolicy } from "@/lib/organization-auth-policy";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { resolveExplicitEntitySelection } from "@/lib/multi-entity-selector-boundary";
import { decideEntityAccess, entityResourceAllowed, GROUP_ENTITY_ROLES } from "@/lib/multi-entity-policy";

export type MultiEntityContext = {
  enabled: boolean;
  group: boolean;
  canSwitch: boolean;
  legalEntityId: number | null;
  organizationId: number;
  role: string;
  entities: Array<{ id: number; legalName: string; displayName: string; code: string }>;
};
export type EntityResult = { ok: true; context: MultiEntityContext } | { ok: false; response: Response };

const denied = (message = "Legal employer is not available to this account.") =>
  Response.json({ error: message, code: "ENTITY_ACCESS_DENIED" }, { status: 403 });
const primaryReconciliationRequired = () => Response.json({
  error: "Legal-employer primary attribution requires independent reconciliation.",
  code: "ENTITY_PRIMARY_RECONCILIATION_REQUIRED",
}, { status: 409 });

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
      enabled: false, group: access.companyWide, canSwitch: false, legalEntityId: null,
      organizationId: input.organizationId, role: access.role, entities: [],
    } };
  }
  const sessionDenied = await assertOrganizationSessionPolicy(input.userId, input.organizationId);
  if (sessionDenied) return { ok: false, response: sessionDenied };
  // The group_hr role alone is not a group-wide grant. A membership narrowed
  // to one org unit must never widen into all legal employers, even if its
  // string role is group_hr. Deny BEFORE querying employer IDs or preferences.
  if (GROUP_ENTITY_ROLES.has(access.role) && !access.companyWide) {
    return { ok: false, response: denied() };
  }

  // Reconcile ALL explicit legal-employer selectors before reading employer
  // metadata. A header must not silently authorize A while a route later
  // consumes query/body B. Duplicate query keys are also invalid.
  // Feature OFF returned above without inspecting any of these selectors.
  const selectors = resolveExplicitEntitySelection({
    requested: input.requested,
    header: input.request?.headers.get("x-legal-entity-id"),
    queryValues: new URL(input.request?.url ?? "https://invalid.local/")
      .searchParams.getAll("legalEntityId"),
  });
  if (!selectors.ok) return { ok: false, response: Response.json({
    error: "Legal employer selectors are invalid or inconsistent.",
    code: selectors.code,
  }, { status: 403 }) };

  const [entities, grants, preference] = await Promise.all([
    db.select({ id: legalEntities.id, legalName: legalEntities.legalName,
      displayName: legalEntities.displayName, code: legalEntities.code,
      primaryEntity: legalEntities.primaryEntity })
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
  // The flag must not activate against a partially migrated tenant. One
  // ACTIVE PRIMARY is mandatory; selecting the first record or assuming the
  // employee's current legal employer would misattribute historic payroll.
  // Read-only metadata check; never silently create/backfill ownership here.
  if (entities.filter(entity => entity.primaryEntity).length !== 1) {
    return { ok: false, response: primaryReconciliationRequired() };
  }
  // A saved preference is only a fallback, never a competing authority.
  // Explicit body/header/query selectors were all validated above.
  const requested = selectors.explicit
    ? selectors.requested
    : preference[0] ? (preference[0].legalEntityId ?? "all") : undefined;
  const policy = {
    role: access.role,
    availableEntityIds: entities.map(entity => entity.id),
    grantedEntityIds: grants.map(grant => grant.legalEntityId),
  };
  let decision = decideEntityAccess({ ...policy, requested });
  // A saved preference is NOT authority. If a role changed from group_hr to
  // scoped, or an old entity grant was revoked, recover to the first currently
  // granted employer without disclosing the stale employer. An explicit
  // client-supplied header/query/parameter must still fail closed instead.
  if (!decision.ok && !selectors.explicit) {
    decision = decideEntityAccess({ ...policy, requested: undefined });
  }
  if (!decision.ok) return { ok: false, response: denied(
    decision.code === "ENTITY_SELECTION_REQUIRED"
      ? "An administrator must assign exactly one legal employer to this role."
      : undefined,
  ) };
  const safeEntities = entities.map(({ id, legalName, displayName, code }) =>
    ({ id, legalName, displayName, code }));
  return { ok: true, context: {
    enabled: true, group: decision.group,
    canSwitch: !decision.group && decision.allowedEntityIds.length > 1,
    legalEntityId: decision.selectedEntityId,
    organizationId: input.organizationId, role: access.role,
    entities: decision.group
      ? safeEntities
      : safeEntities.filter(entity => decision.allowedEntityIds.includes(entity.id)),
  } };
}

/** Resource-ID routes MUST authorize the run/employee/file's actual employer. */
export function assertEntityResource(
  context: MultiEntityContext, resourceEntityId: number | null | undefined,
): Response | null {
  if (!context.enabled) return null;
  const decision = context.legalEntityId === null
    ? { ok: true as const, group: context.group, selectedEntityId: null,
        allowedEntityIds: context.entities.map(entity => entity.id) }
    : { ok: true as const, group: context.group, selectedEntityId: context.legalEntityId,
        allowedEntityIds: context.entities.map(entity => entity.id) };
  if (entityResourceAllowed(decision, resourceEntityId ?? null)) return null;
  return denied();
}

export function entityWhereRequired(context: MultiEntityContext): number | null {
  return context.enabled ? context.legalEntityId : null;
}

export function canReadGroupReport(context: MultiEntityContext): boolean {
  return context.enabled && context.group && GROUP_ENTITY_ROLES.has(context.role);
}
