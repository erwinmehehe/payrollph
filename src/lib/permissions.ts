import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { permissionSets, userOrganizations, userPermissionAssignments } from "@/db/schema";
import { authorizedDynamicGroupMember } from "@/lib/dynamic-group-authorization";

export const ROLE_GATE_PERMISSIONS = [
  "org.admin",
  "people.admin",
  "people.payroll",
  "workforce.manage",
  "developer.admin",
  "billing.admin",
  "approval.admin",
  "payroll.operate",
  "payroll.view",
  "payroll.check",
  "payroll.release",
  "payroll.disburse",
] as const;

export type RoleGatePermission = (typeof ROLE_GATE_PERMISSIONS)[number];

export async function permissionSetForMembership(userId: number, organizationId: number) {
  const [membership] = await db.select().from(userOrganizations).where(and(
    eq(userOrganizations.userId, userId),
    eq(userOrganizations.organizationId, organizationId),
    eq(userOrganizations.active, true),
  )).limit(1);
  if (!membership) return { membership: null, assignment: null, permissionSet: null };

  const [assignment] = await db.select().from(userPermissionAssignments)
    .where(and(
      eq(userPermissionAssignments.organizationId, organizationId),
      eq(userPermissionAssignments.userOrganizationId, membership.id),
    ))
    .limit(1);
  if (!assignment) return { membership, assignment: null, permissionSet: null };

  const [permissionSet] = await db.select().from(permissionSets)
    .where(and(
      eq(permissionSets.id, assignment.permissionSetId),
      eq(permissionSets.organizationId, organizationId),
    ))
    .limit(1);
  return { membership, assignment, permissionSet: permissionSet ?? null };
}

/**
 * Permission sets are deny-only overlays. They never grant beyond the member's
 * base role; an unassigned membership keeps the existing role behavior.
 */
export async function roleGateAllowed(userId: number, organizationId: number, permission: RoleGatePermission) {
  const { permissionSet, assignment } = await permissionSetForMembership(userId, organizationId);
  if (!permissionSet) return { allowed: true as const, restricted: false as const, permissionSet: null };
  if (!permissionSet.active) {
    return { allowed: false as const, restricted: true as const, permissionSet };
  }
  const permissions = Array.isArray(permissionSet.permissions)
    ? permissionSet.permissions.filter((value: unknown): value is string => typeof value === "string")
    : [];
  if (!permissions.includes(permission)) {
    return { allowed: false as const, restricted: true as const, permissionSet };
  }
  // A Dynamic Group may further restrict an existing permission assignment;
  // it cannot grant a role gate outside the member's base role or permission set.
  if (assignment?.dynamicGroupId != null) {
    const eligibility = await authorizedDynamicGroupMember({
      organizationId,
      userId,
      groupId: assignment.dynamicGroupId,
      expectedVersion: assignment.dynamicGroupVersion,
    });
    return {
      allowed: eligibility.eligible,
      restricted: true as const,
      permissionSet,
      dynamicGroupGate: eligibility.reason,
    };
  }
  return {
    allowed: permissions.includes(permission),
    restricted: true as const,
    permissionSet,
  };
}
