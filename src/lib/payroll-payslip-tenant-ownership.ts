import { assertPayrollExportTenantOwnership } from "./payroll-export-tenant-ownership";

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
