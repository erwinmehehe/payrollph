import { and, eq } from "drizzle-orm";
import { employeeHrCases, employees, userOrganizations } from "@/db/schema";

/** A linked employee can resolve only their own case inside their employer. */
export function linkedEmployeeHrCaseScope(caseId: number, organizationId: number, employeeId: number) {
  return and(
    eq(employeeHrCases.id, caseId),
    eq(employeeHrCases.organizationId, organizationId),
    eq(employeeHrCases.employeeId, employeeId),
  );
}

/**
 * Filter staff lookups by active employer membership before selecting case data.
 * This is not an authorization grant: callers must still verify permission,
 * current organization session policy, and organizational-unit scope.
 */
export function activeHrCaseStaffMembership(userId: number) {
  return and(
    eq(userOrganizations.organizationId, employeeHrCases.organizationId),
    eq(userOrganizations.userId, userId),
    eq(userOrganizations.active, true),
  );
}

/** One canonical employer selector, never a coerced or duplicated tenant ID. */
export function explicitHrCaseEmployerId(values: readonly string[]): number | null {
  if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0])) return null;
  const id = Number(values[0]);
  return Number.isSafeInteger(id) ? id : null;
}

/** Apply employer and optional authorized unit restrictions in SQL, not JS. */
export function hrCaseStaffRosterScope(organizationId: number, orgUnitId: number | null) {
  return and(
    eq(employees.organizationId, organizationId),
    orgUnitId === null ? undefined : eq(employees.orgUnitId, orgUnitId),
  );
}
