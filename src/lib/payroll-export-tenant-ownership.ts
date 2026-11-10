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

/**
 * A payslip's employee_id and its payroll entry's employee_id must refer to
 * the same worker of the run's actual employer. Reject the entire result if
 * even one worker or employer association is inconsistent.
 */
export function assertPayrollPayslipTenantOwnership(
  organizationId: number,
  rows: ReadonlyArray<{
    employee: { organizationId: number } | null;
    entryEmployeeId: number;
    slip: { organizationId: number; employeeId: number };
  }>,
): void {
  assertPayrollExportTenantOwnership(organizationId, rows);
  if (rows.some(({ slip, entryEmployeeId }) =>
    slip.organizationId !== organizationId ||
    !Number.isSafeInteger(entryEmployeeId) || entryEmployeeId < 1 ||
    !Number.isSafeInteger(slip.employeeId) || slip.employeeId < 1 ||
    slip.employeeId !== entryEmployeeId
  )) {
    throw new Error("Payroll export unavailable: employee ownership could not be verified.");
  }
}
