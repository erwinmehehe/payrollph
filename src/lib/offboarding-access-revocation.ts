import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
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
  const directlyLinkedEmployeeIds = linked.map(row => row.id);
  // Revoke every employer-A membership tied to the separated employee,
  // including historical linked-logins without a populated workerEmployeeId.
  const scopedMemberships = await tx.update(userOrganizations).set({ active: false })
    .where(and(
      eq(userOrganizations.organizationId, input.organizationId),
      eq(userOrganizations.active, true),
      or(
        eq(userOrganizations.workerEmployeeId, input.employeeId),
        ...(directlyLinkedEmployeeIds.length
          ? [inArray(userOrganizations.userId, directlyLinkedEmployeeIds)] : []),
      ),
    )).returning({ id: userOrganizations.id, userId: userOrganizations.userId });
  // Older ESS records may be linked through the tenant membership alone,
  // without users.employeeId. Those identities still need session revocation.
  // Worker-linked staff identities must reauthenticate too, but may retain
  // legitimate access to a different employer.
  const affectedUserIds = [...new Set([
    ...directlyLinkedEmployeeIds, ...scopedMemberships.map(row => row.userId),
  ])];
  const employeeLogins = affectedUserIds.length
    ? await tx.select({ id: users.id, employeeId: users.employeeId }).from(users)
        .where(and(inArray(users.id, affectedUserIds), eq(users.role, "employee")))
    : [];
  const employeeUserIds = employeeLogins.map(row => row.id);
  const otherEmployerMemberships = employeeUserIds.length
    ? await tx.select({ userId: userOrganizations.userId }).from(userOrganizations)
        .where(and(
          inArray(userOrganizations.userId, employeeUserIds),
          ne(userOrganizations.organizationId, input.organizationId),
          eq(userOrganizations.active, true),
        ))
    : [];
  const retainedLogins = new Set(otherEmployerMemberships.map(row => row.userId));
  const disableIds = employeeUserIds.filter(id => !retainedLogins.has(id));
  const retainedIds = employeeLogins
    .filter(row => retainedLogins.has(row.id) && row.employeeId === input.employeeId)
    .map(row => row.id);
  // A still-active account must not keep the separated employer's global
  // employeeId pointer. Self-service endpoints can use that pointer even
  // before reading tenant membership; require a new authorized HR link.
  if (retainedIds.length) {
    await tx.update(users).set({ employeeId: null })
      .where(and(inArray(users.id, retainedIds), eq(users.role, "employee")));
  }
  // Only disable the login if it no longer serves another employer.
  // All existing sessions must reauthenticate regardless of membership.
  const disabled = disableIds.length
    ? await tx.update(users).set({ active: false, localPasswordEnabled: false })
        .where(and(inArray(users.id, disableIds), eq(users.role, "employee")))
        .returning({ id: users.id })
    : [];
  const revoked = affectedUserIds.length
    ? await tx.update(sessions).set({ revokedAt: new Date() }).where(and(
        inArray(sessions.userId, affectedUserIds), isNull(sessions.revokedAt),
      )).returning({ id: sessions.id })
    : [];

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
      // This transaction revokes only local sessions and memberships.
      // External grant verification is separately governed; never imply it ran.
      externalITGrantsVerifiedRevoked: false,
      externalGrantInventoryVerified: false,
      externalProviderCallsMade: false,
    },
  });
  return {
    disabledEmployeeLoginIds: disabled.map(row => row.id),
    revokedSessionCount: revoked.length,
    revokedEmployerMembershipIds: scopedMemberships.map(row => row.id),
  };
}
