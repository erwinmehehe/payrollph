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

export type Permission =
  | "payroll:read" | "payroll:create" | "payroll:process" | "payroll:approve" | "payroll:release" | "payroll:export" | "payroll:disburse"
  | "members:read" | "members:invite" | "organization:write"
  | "employees:read" | "employees:write" | "employees:import" | "reports:read" | "data:export"
  | "compliance:read" | "compliance:manage" | "billing:read" | "billing:manage"
  | "integrations:read" | "integrations:manage" | "hr:read" | "hr:manage" | "finance:read" | "finance:manage"
  | "approvals:decide" | "assets:read" | "assets:write" | "contractors:read" | "contractors:write" | "mail:read";

const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  owner: [
    "payroll:read", "payroll:create", "payroll:process", "payroll:approve", "payroll:release", "payroll:export", "payroll:disburse",
    "members:read", "members:invite", "organization:write", "employees:read", "employees:write", "employees:import",
    "reports:read", "data:export", "compliance:read", "compliance:manage", "billing:read", "billing:manage",
    "integrations:read", "integrations:manage", "hr:read", "hr:manage", "finance:read", "finance:manage",
    "approvals:decide", "assets:read", "assets:write", "contractors:read", "contractors:write", "mail:read",
  ],
  admin: [
    "payroll:read", "payroll:create", "payroll:process", "payroll:approve", "payroll:release", "payroll:export",
    "members:read", "members:invite", "organization:write", "employees:read", "employees:write", "employees:import",
    "reports:read", "data:export", "compliance:read", "compliance:manage", "billing:read", "billing:manage",
    "integrations:read", "integrations:manage", "hr:read", "hr:manage", "finance:read", "finance:manage",
    "approvals:decide", "assets:read", "assets:write", "contractors:read", "contractors:write", "mail:read",
  ],
  bookkeeper: [
    "payroll:read", "payroll:create", "payroll:process", "payroll:export", "employees:read", "reports:read",
    "compliance:read", "compliance:manage", "finance:read", "finance:manage", "approvals:decide",
    "assets:read", "contractors:read", "contractors:write",
  ],
  hr: [
    "payroll:read", "employees:read", "employees:write", "employees:import", "reports:read", "compliance:read",
    "hr:read", "hr:manage", "approvals:decide", "assets:read", "assets:write", "contractors:read",
  ],
  employee: [],
};

export function roleHasPermission(role: string, permission: Permission) {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function canInviteRole(actorRole: string, invitedRole: string) {
  if (actorRole === "owner") return ["owner", "admin", "hr", "bookkeeper", "employee"].includes(invitedRole);
  if (actorRole === "admin") return ["hr", "bookkeeper", "employee"].includes(invitedRole);
  return false;
}

export async function getAccess(userId: number, organizationId: number): Promise<AccessScope | null> {
  const [membership] = await db.select().from(userOrganizations).where(and(
    eq(userOrganizations.userId, userId), eq(userOrganizations.organizationId, organizationId),
  )).limit(1);
  if (!membership) return null;
  let orgUnitName: string | null = null;
  if (membership.orgUnitId) {
    const [unit] = await db.select().from(orgUnits).where(eq(orgUnits.id, membership.orgUnitId)).limit(1);
    orgUnitName = unit?.name ?? null;
  }
  return { organizationId, role: membership.role, orgUnitId: membership.orgUnitId, orgUnitName, companyWide: membership.orgUnitId == null };
}

export async function primaryOrganizationId(userId: number): Promise<number | null> {
  const [row] = await db.select({ organizationId: userOrganizations.organizationId }).from(userOrganizations)
    .where(eq(userOrganizations.userId, userId)).orderBy(userOrganizations.organizationId).limit(1);
  return row?.organizationId ?? null;
}

export function assertScope(access: AccessScope | null, employeeOrgUnitId: number | null) {
  if (!access) return { ok: false as const, error: "No membership in this organization.", status: 403 };
  if (access.companyWide || employeeOrgUnitId === access.orgUnitId) return { ok: true as const };
  return { ok: false as const, error: `Scoped to ${access.orgUnitName ?? "one unit"} — this employee is outside that unit.`, status: 403 };
}

export async function assertMembership(userId: number, organizationId: number): Promise<Response | null> {
  if (!Number.isInteger(organizationId) || organizationId <= 0) return Response.json({ error: "A valid organizationId is required." }, { status: 400 });
  const access = await getAccess(userId, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (access.role === "employee") return Response.json({ error: "Employee accounts must use self-service routes for their own records." }, { status: 403 });
  return null;
}

export async function assertPermission(userId: number, organizationId: number, permission: Permission): Promise<Response | null> {
  if (!Number.isInteger(organizationId) || organizationId <= 0) return Response.json({ error: "A valid organizationId is required." }, { status: 400 });
  const access = await getAccess(userId, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (!roleHasPermission(access.role, permission)) return Response.json({ error: `Your ${access.role} role does not have permission to ${permission.replace(":", " ")}.`, permission, role: access.role }, { status: 403 });
  return null;
}

export async function assertAnyPermission(userId: number, organizationId: number, permissions: readonly Permission[]): Promise<Response | null> {
  if (!Number.isInteger(organizationId) || organizationId <= 0) return Response.json({ error: "A valid organizationId is required." }, { status: 400 });
  const access = await getAccess(userId, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (!permissions.some((permission) => roleHasPermission(access.role, permission))) return Response.json({ error: `Your ${access.role} role does not have permission for this action.`, requiredAnyOf: permissions, role: access.role }, { status: 403 });
  return null;
}

export async function assertResourceAccess(userId: number, resourceOrganizationId: number): Promise<Response | null> {
  return assertMembership(userId, resourceOrganizationId);
}
