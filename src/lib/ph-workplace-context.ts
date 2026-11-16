import { eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities, employees } from "@/db/schema";
import { assertMembership, assertOrganizationRole, COMPENSATION_MANAGER_ROLES, getAccess } from "@/lib/access";
import { criticalReleaseFlagEnabled, type CriticalReleaseFlag } from "@/lib/critical-release-flags";
import { positiveId } from "@/lib/ph-workplace-compliance-policy";

/**
 * Pilot guard: no multi-legal-entity exposure until legal-entity RBAC is
 * independently tested. No automatic selection of a first legal employer.
 */
export function workplaceFeatureEnabled(flag: CriticalReleaseFlag): boolean {
  return criticalReleaseFlagEnabled(flag) && !criticalReleaseFlagEnabled("multiEntity");
}

export async function workplaceEntity(organizationId: number) {
  const rows = await db.select({ id: legalEntities.id }).from(legalEntities)
    .where(eq(legalEntities.organizationId, organizationId)).limit(2);
  if (rows.length !== 1) {
    return { denied: Response.json({ error: "Workplace compliance is available only for a verified single legal employer." }, { status: 409 }) } as const;
  }
  return { legalEntityId: rows[0].id } as const;
}

export async function workplaceMember(userId: number, organizationId: number) {
  const denied = await assertMembership(userId, organizationId);
  if (denied) return { denied } as const;
  return workplaceEntity(organizationId);
}

export async function workplaceAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(userId, organizationId, COMPENSATION_MANAGER_ROLES,
    "Company-wide Owner, Admin or HR authorization is required.");
  if (denied) return { denied } as const;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) return {
    denied: Response.json({ error: "Company-wide People administration required." }, { status: 403 }),
  } as const;
  return workplaceEntity(organizationId);
}

export async function linkedWorkplaceEmployee(userId: number, employeeId: number | null | undefined, organizationId: number) {
  const id = positiveId(employeeId);
  if (!id) return null;
  const [employee] = await db.select({
    id: employees.id, organizationId: employees.organizationId, legalEntityId: employees.legalEntityId,
  }).from(employees).where(eq(employees.id, id)).limit(1);
  return employee?.organizationId === organizationId ? employee : null;
}

export const workplacePrivateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
export const workplaceNotFound = () => Response.json({ error: "Not found." }, { status: 404, headers: workplacePrivateHeaders });
