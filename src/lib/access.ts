import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgUnits, userOrganizations } from "@/db/schema";

export type AccessScope = {
  organizationId: number;
  role: string;
  orgUnitId: number | null;
  orgUnitName: string | null;
  companyWide: boolean;
};

/**
 * Resolves what a user may see inside an organization.
 * orgUnitId = null means company-wide (bookkeeper / owner).
 * A branch/department admin is limited to that unit unless companyWide.
 */
export async function getAccess(userId: number, organizationId: number): Promise<AccessScope | null> {
  const [membership] = await db.select().from(userOrganizations).where(and(
    eq(userOrganizations.userId, userId),
    eq(userOrganizations.organizationId, organizationId),
  )).limit(1);

  if (!membership) return null;

  let orgUnitName: string | null = null;
  if (membership.orgUnitId) {
    const [unit] = await db.select().from(orgUnits).where(eq(orgUnits.id, membership.orgUnitId)).limit(1);
    orgUnitName = unit?.name ?? null;
  }

  return {
    organizationId,
    role: membership.role,
    orgUnitId: membership.orgUnitId,
    orgUnitName,
    companyWide: membership.orgUnitId == null,
  };
}

/**
 * Account-level events (password/email changes) are not scoped to a client
 * workspace, but the audit table requires one. Attribute them to the user's
 * first membership so the record is real rather than a hardcoded id.
 */
export async function primaryOrganizationId(userId: number): Promise<number | null> {
  const [row] = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(eq(userOrganizations.userId, userId))
    .orderBy(userOrganizations.organizationId)
    .limit(1);
  return row?.organizationId ?? null;
}

export function assertScope(access: AccessScope | null, employeeOrgUnitId: number | null) {
  if (!access) return { ok: false as const, error: "No membership in this organization.", status: 403 };
  if (access.companyWide) return { ok: true as const };
  if (employeeOrgUnitId === access.orgUnitId) return { ok: true as const };
  return {
    ok: false as const,
    error: `Scoped to ${access.orgUnitName ?? "one unit"}, this employee is outside that unit.`,
    status: 403,
  };
}

/**
 * Single authorization gate for every session-authenticated route.
 *
 * Returns null when the user is a member of the organization, otherwise a 403
 * Response. Routes MUST call this with the organization id they are about to
 * read or write, the id coming from a request body or query string is never
 * sufficient on its own, because any signed-in user could otherwise substitute
 * another tenant's id and read their payroll.
 */
export async function assertMembership(userId: number, organizationId: number): Promise<Response | null> {
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "A valid organizationId is required." }, { status: 400 });
  }
  const [row] = await db
    .select({ id: userOrganizations.id })
    .from(userOrganizations)
    .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.organizationId, organizationId)))
    .limit(1);
  if (row) return null;
  return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
}

/** Gate for routes addressed by a resource id: checks the resource's own organization. */
export async function assertResourceAccess(userId: number, resourceOrganizationId: number): Promise<Response | null> {
  return assertMembership(userId, resourceOrganizationId);
}


const PAYROLL_OPERATOR_ROLES = new Set(["admin", "owner", "bookkeeper", "payroll"]);
const PEOPLE_ADMIN_ROLES = new Set(["admin", "owner", "bookkeeper", "hr", "payroll"]);

export function isPayrollOperatorRole(role: string | null | undefined) {
  return Boolean(role && PAYROLL_OPERATOR_ROLES.has(role.toLowerCase()));
}

export function canOperatePayroll(access: AccessScope | null) {
  return Boolean(access && isPayrollOperatorRole(access.role));
}

export function canManageSeparation(access: AccessScope | null) {
  return Boolean(access && PEOPLE_ADMIN_ROLES.has(access.role.toLowerCase()));
}
