/**
 * A current employee roster cannot establish a historical legal employer by
 * itself. When it disagrees with a run's frozen employer, payroll variance must
 * fail closed rather than render salary, bank-change or revision evidence.
 *
 * A missing employee (including a legacy cross-tenant FK), null employer,
 * transferred employee or duplicated/foreign employee is NOT a safe "empty"
 * or "zero variance" result. Call only after authorizing the run and selected
 * employer. Feature-OFF legacy requests are intentionally unaffected.
 */
export type VarianceRosterEmployee = {
  id: number;
  organizationId: number;
  legalEntityId: number | null;
};

export function varianceRosterMatchesRunEmployer(input: {
  organizationId: number;
  legalEntityId: number | null;
  entryEmployeeIds: readonly number[];
  employees: readonly VarianceRosterEmployee[];
}): boolean {
  const validId = (id: number | null): id is number =>
    Number.isSafeInteger(id) && id !== null && id > 0;

  if (!validId(input.organizationId) || !validId(input.legalEntityId)) return false;
  const expected = new Set<number>();
  for (const employeeId of input.entryEmployeeIds) {
    if (!validId(employeeId) || expected.has(employeeId)) return false;
    expected.add(employeeId);
  }
  if (input.employees.length !== expected.size) return false;
  const seen = new Set<number>();
  for (const worker of input.employees) {
    if (!validId(worker.id) || !expected.has(worker.id) || seen.has(worker.id)
      || worker.organizationId !== input.organizationId
      || worker.legalEntityId !== input.legalEntityId) return false;
    seen.add(worker.id);
  }
  return seen.size === expected.size;
}
