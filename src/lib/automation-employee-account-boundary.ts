import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, userOrganizations, users } from "@/db/schema";

/**
 * A global employeeId alone is NOT proof that a login belongs to an employer.
 * Return only accounts with an active membership in that employer, and surface
 * other active memberships before any global session revocation.
 */
export async function tenantLinkedEmployeeAccounts(organizationId: number, employeeId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId < 1 ||
      !Number.isSafeInteger(employeeId) || employeeId < 1) {
    throw new Error("Automation employee/account scope is invalid.");
  }
  const [worker] = await db.select({ id: employees.id }).from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!worker) throw new Error("Automation employee does not belong to this employer.");

  const own = await db.select({ id: users.id }).from(users).innerJoin(userOrganizations, and(
    eq(userOrganizations.userId, users.id),
    eq(userOrganizations.organizationId, organizationId),
    eq(userOrganizations.active, true),
  )).where(eq(users.employeeId, employeeId));
  if (!own.length) return [];

  const foreign = await db.select({ userId: userOrganizations.userId })
    .from(userOrganizations).where(and(
      inArray(userOrganizations.userId, own.map((row) => row.id)),
      ne(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
    ));
  const shared = new Set(foreign.map((row) => row.userId));
  return own.map((row) => ({
    id: row.id,
    sharedWithOtherEmployer: shared.has(row.id),
  }));
}

/** Re-evaluate shared-account membership at the actual session UPDATE. */
export function noOtherActiveEmployerMembership(userId: number, organizationId: number) {
  return sql`NOT EXISTS (
    SELECT 1 FROM user_organizations AS other_employer_sessions
    WHERE other_employer_sessions.user_id = ${userId}
      AND other_employer_sessions.organization_id <> ${organizationId}
      AND other_employer_sessions.active IS TRUE
  )`;
}
