import { and, eq } from "drizzle-orm";
import { employeeHrCases, userOrganizations } from "@/db/schema";

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
