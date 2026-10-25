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


function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonNegativeMoneyString(value: unknown): value is string {
  return typeof value === "string"
    && /^\d+(?:\.\d{1,2})?$/.test(value)
    && Number.isFinite(Number(value));
}

/**
 * The allocation GET is a read-only projection of one employer's planning
 * records. HTTP 200 alone is not proof of a complete, correctly scoped read.
 * The reviewed endpoint has no top-level employer identifier; an empty result
 * can only be accepted with a valid authorization/access shape. Verify every
 * returned row's employer and org-unit scope, including linked submissions.
 * Fail closed on mixed-employer or malformed data rather than displaying it
 * as zero rows or enabling write controls.
 * The server remains authoritative for RBAC and all decisions.
 */
export function workforceAllocationResponseMatchesEmployer(
  payload: unknown,
  organizationId: number,
): boolean {
  const response = objectRecord(payload);
  const access = objectRecord(response?.access);
  if (!positiveId(organizationId) || !response
      || !access || typeof access.role !== "string" || !access.role
      || typeof access.companyWide !== "boolean"
      || (access.orgUnitId !== null && !positiveId(access.orgUnitId))
      || typeof access.canManageAllocations !== "boolean"
      || typeof access.canDecideSubmissions !== "boolean"
      || !Array.isArray(response.allocations) || !Array.isArray(response.submissions)) {
    return false;
  }

  const allocations = new Map<number, { planId: number; orgUnitId: number }>();
  for (const candidate of response.allocations) {
    const row = objectRecord(candidate);
    if (!row || !positiveId(row.id) || row.organizationId !== organizationId
        || !positiveId(row.planId) || !positiveId(row.orgUnitId)
        || (!access.companyWide && access.orgUnitId !== row.orgUnitId)
        || !nonNegativeCount(row.headcountCeiling)
        || !nonNegativeMoneyString(row.annualBudgetCeiling)
        || typeof row.orgUnitName !== "string"
        || allocations.has(row.id)) return false;
    allocations.set(row.id, { planId: row.planId, orgUnitId: row.orgUnitId });
  }

  for (const candidate of response.submissions) {
    const row = objectRecord(candidate);
    if (!row || !positiveId(row.id) || row.organizationId !== organizationId
        || !positiveId(row.planId) || !positiveId(row.allocationId)
        || !positiveId(row.orgUnitId) || !positiveId(row.version)
        || (!access.companyWide && access.orgUnitId !== row.orgUnitId)
        || !nonNegativeCount(row.requestedHeadcount)
        || !nonNegativeMoneyString(row.requestedAnnualBudget)
        || typeof row.status !== "string" || typeof row.rationale !== "string"
        || typeof row.canSubmit !== "boolean" || typeof row.canDecide !== "boolean") return false;
    const allocation = allocations.get(row.allocationId);
    if (!allocation || allocation.planId !== row.planId
        || allocation.orgUnitId !== row.orgUnitId) return false;
  }
  return true;
}
