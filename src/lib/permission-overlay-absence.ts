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

/**
 * Validate the entire permission-set allowlist before honoring any known gate.
 * Filtering malformed/unknown values would let a corrupted overlay broaden
 * rights by accepting its valid-looking subset.
 */
export function permissionOverlayKeysValid(value: unknown, knownKeys: readonly string[]): value is string[] {
  return Array.isArray(value)
    && value.every((key: unknown) => typeof key === "string" && knownKeys.includes(key));
}

/**
 * A Dynamic Group restriction is an atomic (id, frozen-version) binding.
 * If either side is missing or invalid, never interpret it as no guard:
 * that would silently broaden an assigned deny-only permission overlay.
 */
export function permissionOverlayGroupBindingValid(binding: {
  dynamicGroupId: number | null;
  dynamicGroupVersion: number | null;
}): boolean {
  if (binding.dynamicGroupId == null) return binding.dynamicGroupVersion == null;
  return Number.isSafeInteger(binding.dynamicGroupId)
    && binding.dynamicGroupId > 0
    && Number.isSafeInteger(binding.dynamicGroupVersion)
    && binding.dynamicGroupVersion !== null
    && binding.dynamicGroupVersion >= 1;
}
