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

/**
 * Bind the HR staff roster to the authenticated organization, assigned unit,
 * AND (when multi-entity is enabled) the single granted legal employer.
 * Never fall back to an all-employer roster when the legal employer is missing.
 * The caller must obtain legalEntityId from resolveMultiEntityContext, never
 * from an unverified request parameter.
 */
export function hrCaseStaffRosterScope(
  organizationId: number, orgUnitId: number | null, legalEntityId: number | null = null,
) {
  return and(
    eq(employees.organizationId, organizationId),
    orgUnitId === null ? undefined : eq(employees.orgUnitId, orgUnitId),
    legalEntityId === null ? undefined : eq(employees.legalEntityId, legalEntityId),
  );
}
