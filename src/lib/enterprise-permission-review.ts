import { permissionOverlayGroupBindingValid, permissionOverlayKeysValid } from "./permission-overlay-absence";

/**
 * Read-only enterprise role/permission-set reconciliation.
 * This is NOT an authorization decision: base-role guards and live Dynamic Group
 * checks remain authoritative at request time. A permission-set overlay is
 * deny-only and must never be presented as a grant.
 */
export type EnterprisePermissionReviewInput = {
  organizationId: number;
  availablePermissions: readonly string[];
  members: ReadonlyArray<{
    membershipId: number; userId: number; role: string; orgUnitId: number | null;
    membershipActive: boolean; active: boolean;
  }>;
  permissionSets: ReadonlyArray<{
    id: number; organizationId: number; name: string; active: boolean; permissions: unknown;
  }>;
  assignments: ReadonlyArray<{
    organizationId: number; userOrganizationId: number; permissionSetId: number;
    dynamicGroupId: number | null; dynamicGroupVersion: number | null;
  }>;
  groups: ReadonlyArray<{
    id: number; code: string; version: number; active: boolean;
  }>;
};

export function projectEnterprisePermissionReview(input: EnterprisePermissionReviewInput) {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0) {
    throw new Error("Permission review requires a valid selected employer.");
  }
  const permissionKeys = [...new Set(input.availablePermissions)];
  if (permissionKeys.some(key => !key || typeof key !== "string")) {
    throw new Error("Permission review requires valid role gate keys.");
  }
  const sets = new Map(input.permissionSets
    .filter(row => row.organizationId === input.organizationId)
    .map(row => [row.id, row]));
  const groups = new Map(input.groups.map(row => [row.id, row]));

  return input.members
    .filter(member => Number.isSafeInteger(member.membershipId) && member.membershipId > 0)
    .sort((a, b) => a.membershipId - b.membershipId)
    .map(member => {
      const assignments = input.assignments.filter(row =>
        row.organizationId === input.organizationId
        && row.userOrganizationId === member.membershipId);
      const base = {
        membershipId: member.membershipId,
        userId: member.userId,
        role: member.role,
        orgUnitId: member.orgUnitId,
        // These lists describe the *overlay only*, not the role's effective grants.
        listedByOverlay: [] as string[],
        deniedByOverlay: [] as string[],
        permissionSetId: null as number | null,
        dynamicGroupId: null as number | null,
        state: "base-role-only",
      };
      if (!member.active || !member.membershipActive) {
        return { ...base, state: "inactive-member" };
      }
      if (assignments.length === 0) return base;
      const deny = (state: string) => ({
        ...base, state, deniedByOverlay: permissionKeys,
      });
      if (assignments.length !== 1) return deny("invalid-assignment");
      const assignment = assignments[0]!;
      const set = sets.get(assignment.permissionSetId);
      if (!set || !set.active || !permissionOverlayKeysValid(set.permissions, permissionKeys)) {
        return { ...deny("invalid-or-inactive-overlay"), permissionSetId: assignment.permissionSetId };
      }
      if (!permissionOverlayGroupBindingValid(assignment)) {
        return { ...deny("invalid-dynamic-group"), permissionSetId: set.id,
          dynamicGroupId: assignment.dynamicGroupId };
      }
      const listed = permissionKeys.filter(key => set.permissions.includes(key));
      const denied = permissionKeys.filter(key => !listed.includes(key));
      if (assignment.dynamicGroupId !== null) {
        const group = groups.get(assignment.dynamicGroupId);
        if (!group || !group.active
          || !Number.isSafeInteger(assignment.dynamicGroupVersion)
          || group.version !== assignment.dynamicGroupVersion) {
          return { ...deny("invalid-dynamic-group"), permissionSetId: set.id,
            dynamicGroupId: assignment.dynamicGroupId };
        }
        return { ...base, state: "conditional-dynamic-group-overlay",
          permissionSetId: set.id, dynamicGroupId: group.id,
          listedByOverlay: listed, deniedByOverlay: denied };
      }
      if (assignment.dynamicGroupVersion !== null) {
        return { ...deny("invalid-dynamic-group"), permissionSetId: set.id };
      }
      return { ...base, state: "deny-only-overlay",
        permissionSetId: set.id, listedByOverlay: listed, deniedByOverlay: denied };
    });
}
