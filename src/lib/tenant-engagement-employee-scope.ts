import { and, eq, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employees, userOrganizations, users } from "@/db/schema";

/**
 * An active membership is not sufficient to act as an employee of that
 * employer. The signed-in account's current employee pointer must identify
 * a worker belonging to the same organization. Legacy nullable membership
 * worker links remain supported; contradictory non-null links fail closed.
 *
 * Call only after the route/page has already established its tenant, role,
 * privacy, and feature gates. This does not grant employee authorization.
 */
export async function employeeBoundToEngagementEmployer(
  userId: number, employeeId: number, organizationId: number,
): Promise<boolean> {
  if (![userId, employeeId, organizationId].every(
    value => Number.isSafeInteger(value) && value > 0
  )) return false;

  const [account] = await db.select({ employeeId: employees.id })
    .from(users)
    .innerJoin(userOrganizations, and(
      eq(userOrganizations.userId, users.id),
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
      eq(userOrganizations.role, "employee"),
    ))
    .innerJoin(employees, and(
      eq(employees.id, users.employeeId),
      eq(employees.organizationId, organizationId),
    ))
    .where(and(
      eq(users.id, userId),
      eq(users.active, true),
      eq(users.role, "employee"),
      eq(users.employeeId, employeeId),
      or(
        isNull(userOrganizations.workerEmployeeId),
        eq(userOrganizations.workerEmployeeId, employees.id),
      ),
    )).limit(1);

  return Boolean(account);
}
