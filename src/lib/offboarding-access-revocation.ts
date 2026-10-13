import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, separationRecords, sessions, users, userOrganizations } from "@/db/schema";
import { manilaCalendarDate } from "@/lib/payroll-period-ui";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Must run inside a transaction. The final-pay release mode requires a worker
 * already changed to Separated. A separately authorized last-day cutoff can
 * revoke local access while final pay is still pending, but never before the
 * effective date or without an independently prepared separation.
 */
export async function revokeSeparatedEmployeeAccessTx(tx: DbTransaction, input: {
  organizationId: number;
  employeeId: number;
  separationId: number;
  actorUserId: number;
  actorName: string;
  mode?: "final-pay-release" | "last-day-local-access";
  cutoffEvidenceReference?: string;
}): Promise<{
  disabledEmployeeLoginIds: number[];
  revokedSessionCount: number;
  revokedEmployerMembershipIds: number[];
}> {
  if (![input.organizationId, input.employeeId, input.separationId, input.actorUserId]
    .every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("OFFBOARDING_ACCESS_INVALID_IDENTITY");
  }
  const mode = input.mode ?? "final-pay-release";
  if (mode !== "final-pay-release" && mode !== "last-day-local-access") {
    throw new Error("OFFBOARDING_ACCESS_INVALID_MODE");
  }
  const [separated] = await tx.select({ status: employees.status }).from(employees).where(and(
    eq(employees.id, input.employeeId),
    eq(employees.organizationId, input.organizationId),
  )).for("update").limit(1);
  if (!separated) throw new Error("OFFBOARDING_ACCESS_EMPLOYEE_NOT_SEPARATED");
  if (mode === "last-day-local-access") {
    const [sep] = await tx.select({
      employeeId: separationRecords.employeeId, status: separationRecords.status,
      lastDay: separationRecords.lastDay,
      preparedByUserId: separationRecords.preparedByUserId,
    }).from(separationRecords).where(and(
      eq(separationRecords.id, input.separationId),
      eq(separationRecords.organizationId, input.organizationId),
    )).limit(1);
    if (!sep || sep.employeeId !== input.employeeId
      || !["draft", "approved"].includes(sep.status)
      || !["Separating", "Separated"].includes(separated.status)) {
      throw new Error("OFFBOARDING_ACCESS_CUTOFF_NOT_ELIGIBLE");
    }
    if (String(sep.lastDay) > manilaCalendarDate()) {
      throw new Error("OFFBOARDING_ACCESS_LAST_DAY_PENDING");
    }
    if (sep.preparedByUserId == null || sep.preparedByUserId === input.actorUserId) {
      throw new Error("OFFBOARDING_ACCESS_INDEPENDENT_REVIEW_REQUIRED");
    }
    const evidence = input.cutoffEvidenceReference?.trim() ?? "";
    if (evidence.length < 8 || evidence.length > 200) {
      throw new Error("OFFBOARDING_ACCESS_EVIDENCE_REQUIRED");
    }
  } else if (separated.status !== "Separated") {
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
    action: mode === "last-day-local-access"
      ? "Separation last-day local application access revoked"
      : "Separated worker application access revoked",
    resource: "Employee " + input.employeeId,
    metadata: {
      separationId: input.separationId, actorUserId: input.actorUserId,
      revocationMode: mode,
      ...(mode === "last-day-local-access"
        ? { cutoffEvidenceReference: input.cutoffEvidenceReference?.trim(),
            finalPayStateChanged: false, payoutExecuted: false } : {}),
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
