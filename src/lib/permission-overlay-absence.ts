/**
 * An unassigned membership keeps its base role. A dangling assigned overlay
 * is NOT equivalent to no assignment and must never broaden access.
 * This pure helper is shared by the runtime gate and regression tests.
 */
export function absentPermissionOverlayDecision(hasAssignment: boolean) {
  if (hasAssignment) {
    return {
      allowed: false as const,
      restricted: true as const,
      permissionSet: null,
      reason: "missing-assigned-permission-set" as const,
    };
  }
  return {
    allowed: true as const,
    restricted: false as const,
    permissionSet: null,
  };
}
