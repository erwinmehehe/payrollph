import { and, eq } from "drizzle-orm";
import { employees } from "@/db/schema";

/**
 * Constructs the tenant AND employer AND org-unit SQL predicate used by
 * payroll-adjacent personnel reads. The caller MUST first resolve an
 * authenticated entity context; passing null employer is only appropriate
 * for the approved group-HR All view or when the feature flag is OFF.
 */
export function employeeScopePredicate(input: {
  organizationId: number;
  legalEntityId: number | null;
  orgUnitId: number | null;
}) {
  return and(
    eq(employees.organizationId, input.organizationId),
    input.legalEntityId === null ? undefined : eq(employees.legalEntityId, input.legalEntityId),
    input.orgUnitId === null ? undefined : eq(employees.orgUnitId, input.orgUnitId),
  );
}
