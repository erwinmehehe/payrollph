import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dynamicWorkerGroups, userOrganizations, users } from "@/db/schema";
import { validDynamicWorkerGroupConditions, workerMatchesDynamicGroup } from "@/lib/dynamic-worker-group-conditions";
import { loadWorkerAttributeContext } from "@/lib/worker-attribute-context";

export type DynamicGroupGateResult = {
  eligible: boolean;
  reason:
    | "eligible"
    | "account_not_linked"
    | "account_inactive"
    | "group_missing_or_inactive"
    | "group_version_changed"
    | "invalid_group_definition"
    | "worker_missing_or_inactive"
    | "outside_membership_scope"
    | "not_group_member";
  groupId: number | null;
  groupVersion: number | null;
  employeeId: number | null;
};

export function evaluateDynamicGroupGate(input: {
  group: { id: number; version: number; conditions: unknown; active: boolean } | null;
  expectedVersion?: number | null;
  context: Record<string, unknown> | null;
  memberOrgUnitId: number | null;
  employeeId: number | null;
}): DynamicGroupGateResult {
  const base = {
    groupId: input.group?.id ?? null,
    groupVersion: input.group?.version ?? null,
    employeeId: input.employeeId,
  };
  if (!input.group?.active) return { ...base, eligible: false, reason: "group_missing_or_inactive" };
  if (input.expectedVersion != null && input.group.version !== input.expectedVersion) {
    return { ...base, eligible: false, reason: "group_version_changed" };
  }
  if (!validDynamicWorkerGroupConditions(input.group.conditions)) {
    return { ...base, eligible: false, reason: "invalid_group_definition" };
  }
  if (!input.employeeId || !input.context || input.context.employeeId !== input.employeeId || input.context.employeeStatus !== "Active") {
    return { ...base, eligible: false, reason: "worker_missing_or_inactive" };
  }
  if (input.memberOrgUnitId != null && input.memberOrgUnitId !== input.context.orgUnitId) {
    return { ...base, eligible: false, reason: "outside_membership_scope" };
  }
  return workerMatchesDynamicGroup(input.group.conditions, input.context)
    ? { ...base, eligible: true, reason: "eligible" }
    : { ...base, eligible: false, reason: "not_group_member" };
}

/** Uses only an explicitly verified organization worker link (or the employee
 * self-service identity already provisioned on the user account). Never
 * infers worker identity from an email, name, or organization role.
 */
export async function authorizedDynamicGroupMember(input: {
  organizationId: number;
  userId: number;
  groupId: number;
  expectedVersion?: number | null;
  expectedCode?: string | null;
}): Promise<DynamicGroupGateResult> {
  const unavailable = (reason: DynamicGroupGateResult["reason"]): DynamicGroupGateResult =>
    ({ eligible: false, reason, groupId: null, groupVersion: null, employeeId: null });

  const [[membership], [user], [group]] = await Promise.all([
    db.select({
      workerEmployeeId: userOrganizations.workerEmployeeId,
      orgUnitId: userOrganizations.orgUnitId,
      role: userOrganizations.role,
    }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, input.userId),
      eq(userOrganizations.organizationId, input.organizationId),
      eq(userOrganizations.active, true),
    )).limit(1),
    db.select({
      employeeId: users.employeeId,
      active: users.active,
    }).from(users).where(eq(users.id, input.userId)).limit(1),
    db.select({
      id: dynamicWorkerGroups.id,
      code: dynamicWorkerGroups.code,
      organizationId: dynamicWorkerGroups.organizationId,
      version: dynamicWorkerGroups.version,
      conditions: dynamicWorkerGroups.conditions,
      active: dynamicWorkerGroups.active,
    }).from(dynamicWorkerGroups).where(and(
      eq(dynamicWorkerGroups.id, input.groupId),
      eq(dynamicWorkerGroups.organizationId, input.organizationId),
    )).limit(1),
  ]);

  if (!membership || !user) return unavailable("account_not_linked");
  if (!user.active) return unavailable("account_inactive");
  if (!group || group.organizationId !== input.organizationId ||
    (input.expectedCode && group.code !== input.expectedCode)) {
    return unavailable("group_missing_or_inactive");
  }

  const employeeId = membership.workerEmployeeId ??
    (membership.role === "employee" ? user.employeeId : null);
  if (!Number.isInteger(employeeId) || !employeeId || employeeId <= 0) {
    return unavailable("account_not_linked");
  }
  const context = await loadWorkerAttributeContext({
    organizationId: input.organizationId,
    employeeId,
  });

  return evaluateDynamicGroupGate({
    group,
    expectedVersion: input.expectedVersion,
    context: context as unknown as Record<string, unknown> | null,
    memberOrgUnitId: membership.orgUnitId,
    employeeId,
  });
}
