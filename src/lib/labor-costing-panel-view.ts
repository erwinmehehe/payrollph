/**
 * Read-only selection and draft reconciliation for the labor-costing editor.
 * Keep the returned employee scoped to the currently visible employer; no
 * effect, payroll calculation, API mutation or server permission is involved.
 */
export function selectedLaborCostingEmployeeId(
  requestedId: number,
  employees: readonly { id: number }[],
): number {
  return employees.some((employee) => employee.id === requestedId)
    ? requestedId
    : (employees[0]?.id ?? 0);
}

/**
 * Match the prior cost-center synchronization behavior after each successful
 * GET: preserve active choices and all finance dimension/amount draft fields;
 * map an invalid first row to the first active center, and clear later ones.
 * An empty active catalog cannot create a valid allocation.
 */
export function reconcileLaborCostingDraftCenters<T extends { costCenterId: string }>(
  drafts: T[],
  centers: readonly { id: number; active: boolean }[],
): T[] {
  const activeCenters = centers.filter((center) => center.active);
  if (activeCenters.length === 0) return drafts;
  const allowed = new Set(activeCenters.map((center) => String(center.id)));
  const first = String(activeCenters[0].id);
  let changed = false;
  const result = drafts.map((row, index) => {
    if (allowed.has(row.costCenterId)) return row;
    const costCenterId = index === 0 ? first : "";
    if (row.costCenterId === costCenterId) return row;
    changed = true;
    return { ...row, costCenterId };
  });
  return changed ? result : drafts;
}
