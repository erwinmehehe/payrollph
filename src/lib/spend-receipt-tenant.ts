/**
 * Narrow receipt permission check. The account's global employeeId is not an
 * employer grant: the worker row and active membership must identify the same
 * employee in the same employer. Nullable legacy worker links remain valid only
 * with the account's matching employee pointer.
 *
 * This is an additional guard, not a replacement for session policy, custom
 * permissions, MFA or the route's initial organization role/scope checks.
 */
export function receiptGrantMatches(
  input: {
    userId: number;
    accountRole: string;
    accountEmployeeId: number | null;
    claim: { organizationId: number; employeeId: number };
    employee: { id: number; organizationId: number; orgUnitId: number | null } | null;
    membership: {
      userId: number;
      organizationId: number;
      role: string;
      active: boolean;
      orgUnitId: number | null;
      workerEmployeeId: number | null;
    } | null;
  },
  staffRoles: readonly string[],
): boolean {
  const { userId, accountRole, accountEmployeeId, claim, employee, membership } = input;
  if (!Number.isSafeInteger(userId) || userId <= 0 ||
      !Number.isSafeInteger(claim.organizationId) || claim.organizationId <= 0 ||
      !Number.isSafeInteger(claim.employeeId) || claim.employeeId <= 0 ||
      !employee || employee.id !== claim.employeeId ||
      employee.organizationId !== claim.organizationId ||
      !membership || !membership.active ||
      membership.userId !== userId ||
      membership.organizationId !== claim.organizationId) {
    return false;
  }

  if (accountRole === "employee") {
    return membership.role === "employee" &&
      accountEmployeeId === employee.id &&
      (membership.workerEmployeeId === null || membership.workerEmployeeId === employee.id);
  }

  // Only already-authorized payroll/People staff retain their current scope.
  // A unit-scoped member cannot become company-wide by carrying a stale grant.
  return staffRoles.includes(membership.role) &&
    (membership.orgUnitId === null ||
      (membership.orgUnitId !== null && Number.isSafeInteger(membership.orgUnitId) &&
       membership.orgUnitId > 0 &&
       membership.orgUnitId === employee.orgUnitId));
}
