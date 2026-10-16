import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { assertMembership, getAccess, type AccessScope } from "@/lib/access";

/** Hide retired metadata and bytes from normal vault access; retain audited
 * object pointers until A-5 retention, legal-hold and erasure approvals. */
export const VAULT_REMOVED_SOURCE_PREFIX = "vault-removed:";

export function vaultRecordRemoved(sourceKey: string | null | undefined): boolean {
  return Boolean(sourceKey?.startsWith(VAULT_REMOVED_SOURCE_PREFIX));
}

export function employeeVaultRoleAllowed(input: {
  role: string;
  companyWide: boolean;
  actorOrgUnitId: number | null;
  targetOrgUnitId: number | null;
  actorEmployeeId: number | null;
  targetEmployeeId: number;
}): boolean {
  if (!Number.isSafeInteger(input.targetEmployeeId) || input.targetEmployeeId <= 0) return false;
  if (input.role === "employee") return input.actorEmployeeId === input.targetEmployeeId;
  // A manager sharing an organizational unit is not an approved 201-file policy.
  if (input.role !== "owner" && input.role !== "hr") return false;
  if (input.companyWide) return true;
  return input.role === "hr" && input.targetOrgUnitId != null &&
    input.targetOrgUnitId === input.actorOrgUnitId;
}

export function employeeVaultCanRemove(input: {
  role: string; actorUserId: number; uploadedByUserId: number | null;
}): boolean {
  return input.role === "owner" || input.role === "hr" ||
    (input.role === "employee" && input.uploadedByUserId === input.actorUserId);
}

export type EmployeeVaultAuthorization =
  | { ok: true; access: AccessScope }
  | { ok: false; response: Response };

/** Resolve active membership and the target's *actual* tenant/unit first. */
export async function authorizeEmployeeVault(
  user: { id: number; employeeId?: number | null },
  organizationId: number,
  employeeId: number,
): Promise<EmployeeVaultAuthorization> {
  if (![organizationId, employeeId].every(id => Number.isSafeInteger(id) && id > 0)) {
    return { ok: false, response: Response.json({ error: "Valid employer and employee required." }, { status: 400 }) };
  }
  const membershipDenied = await assertMembership(user.id, organizationId);
  if (membershipDenied) return { ok: false, response: membershipDenied };
  const access = await getAccess(user.id, organizationId);
  if (!access) return { ok: false, response: Response.json({ error: "Access denied." }, { status: 403 }) };
  const [target] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId })
    .from(employees).where(and(
      eq(employees.id, employeeId), eq(employees.organizationId, organizationId),
    )).limit(1);
  if (!target) return { ok: false, response: Response.json({ error: "Employee not found." }, { status: 404 }) };
  if (!employeeVaultRoleAllowed({
    role: access.role, companyWide: access.companyWide,
    actorOrgUnitId: access.orgUnitId, targetOrgUnitId: target.orgUnitId,
    actorEmployeeId: user.employeeId ?? null, targetEmployeeId: target.id,
  })) {
    return { ok: false, response: Response.json({ error: "Employee vault access denied." }, { status: 403 }) };
  }
  return { ok: true, access };
}
