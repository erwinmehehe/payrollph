import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { orgUnits, userOrganizations } from "@/db/schema";
import { assertOrganizationSessionPolicy } from "@/lib/organization-auth-policy";
import { roleGateAllowed, type RoleGatePermission } from "@/lib/permissions";

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
    eq(userOrganizations.active, true),
  )).limit(1);

  if (!membership) return null;

  let orgUnitName: string | null = null;
  if (membership.orgUnitId) {
    const [unit] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, membership.orgUnitId),
      eq(orgUnits.organizationId, organizationId),
    )).limit(1);
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
    .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.active, true)))
    .orderBy(userOrganizations.organizationId)
    .limit(1);
  return row?.organizationId ?? null;
}

export async function primaryCompanyOrganizationId(userId: number): Promise<number | null> {
  const [row] = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(and(
      eq(userOrganizations.userId, userId),
      eq(userOrganizations.active, true),
      ne(userOrganizations.role, "employee"),
    ))
    .orderBy(userOrganizations.organizationId)
    .limit(1);
  return row?.organizationId ?? null;
}

export async function primaryEmployeeOrganizationId(userId: number): Promise<number | null> {
  const [row] = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(and(
      eq(userOrganizations.userId, userId),
      eq(userOrganizations.active, true),
      eq(userOrganizations.role, "employee"),
    ))
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
    .where(and(
      eq(userOrganizations.userId, userId),
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
    ))
    .limit(1);
  if (!row) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  return assertOrganizationSessionPolicy(userId, organizationId);
}

/** Gate for routes addressed by a resource id: checks the resource's own organization. */
export async function assertResourceAccess(userId: number, resourceOrganizationId: number): Promise<Response | null> {
  return assertMembership(userId, resourceOrganizationId);
}

/**
 * Enforces an organization-unit boundary for resources that may be company-wide.
 * Company-wide memberships can access any unit. Unit-scoped memberships may
 * access only resources explicitly bound to their own unit; a null resource
 * scope means company-wide and is therefore denied to unit-scoped users.
 */
export async function assertOrganizationUnitAccess(
  userId: number,
  organizationId: number,
  resourceOrgUnitId: number | null,
  message = "This resource is outside your assigned organization unit.",
): Promise<Response | null> {
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }
  const authDenied = await assertOrganizationSessionPolicy(userId, organizationId);
  if (authDenied) return authDenied;
  if (access.companyWide) return null;
  if (resourceOrgUnitId != null && resourceOrgUnitId === access.orgUnitId) return null;
  return Response.json({ error: message }, { status: 403 });
}


export const ORG_ADMIN_ROLES = ["owner", "admin", "bookkeeper"] as const;
export const PEOPLE_ADMIN_ROLES = ["owner", "admin", "bookkeeper", "hr"] as const;
export const PEOPLE_PAYROLL_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll"] as const;
export const WORKFORCE_MANAGER_ROLES = ["owner", "admin", "bookkeeper", "hr", "manager"] as const;
export const DEVELOPER_ADMIN_ROLES = ["owner", "admin", "bookkeeper"] as const;
export const BILLING_ADMIN_ROLES = ["owner", "admin", "bookkeeper"] as const;
export const APPROVAL_ADMIN_ROLES = ["owner", "admin", "bookkeeper", "hr"] as const;
export const PAYROLL_OPERATOR_ROLES = ["owner", "admin", "bookkeeper", "payroll"] as const;
export const PAYROLL_VIEW_ROLES = ["owner", "admin", "bookkeeper", "payroll", "checker"] as const;
// Preparing payroll and approving/releasing it are deliberately separate powers.
// Bookkeepers/payroll processors can prepare and export, but they cannot act as
// their own checker or release money-bearing payroll state.
export const PAYROLL_CHECKER_ROLES = ["owner", "admin", "manager", "checker"] as const;
export const PAYROLL_RELEASE_ROLES = ["owner", "admin"] as const;
export const PAYROLL_DISBURSEMENT_ROLES = ["owner"] as const;

export function roleAllowed(role: string, allowedRoles: readonly string[]) {
  return allowedRoles.includes(role);
}

function permissionForRoleGate(allowedRoles: readonly string[]): RoleGatePermission | null {
  if (allowedRoles === ORG_ADMIN_ROLES) return "org.admin";
  if (allowedRoles === PEOPLE_ADMIN_ROLES) return "people.admin";
  if (allowedRoles === PEOPLE_PAYROLL_ROLES) return "people.payroll";
  if (allowedRoles === WORKFORCE_MANAGER_ROLES) return "workforce.manage";
  if (allowedRoles === DEVELOPER_ADMIN_ROLES) return "developer.admin";
  if (allowedRoles === BILLING_ADMIN_ROLES) return "billing.admin";
  if (allowedRoles === APPROVAL_ADMIN_ROLES) return "approval.admin";
  if (allowedRoles === PAYROLL_OPERATOR_ROLES) return "payroll.operate";
  if (allowedRoles === PAYROLL_VIEW_ROLES) return "payroll.view";
  if (allowedRoles === PAYROLL_CHECKER_ROLES) return "payroll.check";
  if (allowedRoles === PAYROLL_RELEASE_ROLES) return "payroll.release";
  if (allowedRoles === PAYROLL_DISBURSEMENT_ROLES) return "payroll.disburse";
  return null;
}

export async function assertOrganizationRole(
  userId: number,
  organizationId: number,
  allowedRoles: readonly string[],
  message = "You do not have permission to perform this action.",
): Promise<Response | null> {
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }
  if (!roleAllowed(access.role, allowedRoles)) {
    return Response.json({ error: message, role: access.role }, { status: 403 });
  }
  const authDenied = await assertOrganizationSessionPolicy(userId, organizationId);
  if (authDenied) return authDenied;

  const permission = permissionForRoleGate(allowedRoles);
  if (permission) {
    const gate = await roleGateAllowed(userId, organizationId, permission);
    if (!gate.allowed) {
      return Response.json({
        error: "Your custom permission set does not allow this action.",
        permission,
        permissionSet: gate.permissionSet?.name ?? null,
      }, { status: 403 });
    }
  }
  return null;
}
