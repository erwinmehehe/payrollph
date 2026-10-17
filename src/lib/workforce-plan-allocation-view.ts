/**
 * A plan is selected by default when a catalog first arrives. An explicit
 * nonempty selection is preserved; an obsolete selection must not silently
 * authorize a different plan's allocation or submission.
 */
export function effectiveWorkforcePlanId(
  plans: readonly { id: number }[],
  selectedId: string,
): string {
  return selectedId || (plans[0] ? String(plans[0].id) : "");
}

/**
 * An allocation may only be submitted against the visible plan's allocation
 * list. Never rely on a reset effect running before a POST or on the browser's
 * visual fallback for a controlled select with a stale value.
 */
export function scopedWorkforceAllocationId(
  allocations: readonly { id: number }[],
  selectedId: string,
): string {
  return selectedId && allocations.some((allocation) => String(allocation.id) === selectedId)
    ? selectedId
    : "";
}
