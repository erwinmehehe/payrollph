import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, sessions, users, userOrganizations } from "@/db/schema";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Must be called INSIDE the same serializable final-pay release transaction,
 * after conditional employee status transition to Separated. Never call for
 * mere resignation intent, before the last day, or with a different tenant.
 */
export async function revokeSeparatedEmployeeAccessTx(tx: DbTransaction, input: {
  organizationId: number;
  employeeId: number;
  separationId: number;
  actorUserId: number;
  actorName: string;
}): Promise<{
  disabledEmployeeLoginIds: number[];
  revokedSessionCount: number;
  revokedEmployerMembershipIds: number[];
}> {
  if (![input.organizationId, input.employeeId, input.separationId, input.actorUserId]
    .every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("OFFBOARDING_ACCESS_INVALID_IDENTITY");
  }
  const [separated] = await tx.select({ status: employees.status }).from(employees).where(and(
    eq(employees.id, input.employeeId),
    eq(employees.organizationId, input.organizationId),
  )).limit(1);
  if (!separated || separated.status !== "Separated") {
    throw new Error("OFFBOARDING_ACCESS_EMPLOYEE_NOT_SEPARATED");
  }

  const linked = await tx.select({ id: users.id }).from(users).where(and(
    eq(users.employeeId, input.employeeId),
    eq(users.role, "employee"),
  ));
  const employeeUserIds = linked.map(row => row.id);
  const disabled = employeeUserIds.length
    ? await tx.update(users).set({ active: false, localPasswordEnabled: false })
        .where(and(inArray(users.id, employeeUserIds), eq(users.role, "employee")))
        .returning({ id: users.id })
    : [];
  const revoked = employeeUserIds.length
    ? await tx.update(sessions).set({ revokedAt: new Date() }).where(and(
        inArray(sessions.userId, employeeUserIds), isNull(sessions.revokedAt),
      )).returning({ id: sessions.id })
    : [];
  const scopedMemberships = await tx.update(userOrganizations).set({ active: false })
    .where(and(
      eq(userOrganizations.organizationId, input.organizationId),
      eq(userOrganizations.workerEmployeeId, input.employeeId),
      eq(userOrganizations.active, true),
    )).returning({ id: userOrganizations.id });

  // Append access evidence to the same atomic commit. A failed audit write
  // also rolls back session revocation, memberships, and final-pay release.
  await tx.insert(auditEvents).values({
    organizationId: input.organizationId, actor: input.actorName,
    action: "Separated worker application access revoked",
    resource: "Employee " + input.employeeId,
    metadata: {
      separationId: input.separationId, actorUserId: input.actorUserId,
      disabledEmployeeLoginIds: disabled.map(row => row.id),
      revokedSessionCount: revoked.length,
      revokedEmployerMembershipIds: scopedMemberships.map(row => row.id),
      externalITGrantsVerifiedRevoked: true,
      externalProviderCallsMade: false,
    },
  });
  return {
    disabledEmployeeLoginIds: disabled.map(row => row.id),
    revokedSessionCount: revoked.length,
    revokedEmployerMembershipIds: scopedMemberships.map(row => row.id),
  };
}
