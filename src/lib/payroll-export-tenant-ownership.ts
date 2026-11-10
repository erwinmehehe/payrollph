/**
 * Fail closed before serializing or decrypting employee details from a payroll
 * export. A payroll-entry foreign key alone does not establish that its worker
 * belongs to the payroll run's employer.
 */
export function assertPayrollExportTenantOwnership(
  organizationId: number,
  rows: ReadonlyArray<{ employee: { organizationId: number } | null }>,
): void {
  if (!Number.isSafeInteger(organizationId) || organizationId < 1
    || rows.some((row) => row.employee?.organizationId !== organizationId)) {
    throw new Error("Payroll export unavailable: employee ownership could not be verified.");
  }
}
