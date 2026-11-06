/**
 * A globally-addressed payroll run is not an authorization grant.
 * Client approval requires an ACTIVE, company-wide owner/admin membership
 * in the same employer AND that employer's designated client approver.
 * Re-evaluate this predicate under row locks at the write boundary.
 */
export function activeManagedPayrollClientApprover(
  actorUserId: number,
  organizationId: number,
  membership: {
    userId: number;
    organizationId: number;
    active: boolean;
    role: string;
    orgUnitId: number | null;
  } | null | undefined,
  engagement: {
    organizationId: number;
    clientApproverUserId: number;
  } | null | undefined,
): boolean {
  return Boolean(
    membership
    && membership.active === true
    && membership.userId === actorUserId
    && membership.organizationId === organizationId
    && membership.orgUnitId === null
    && (membership.role === "owner" || membership.role === "admin")
    && engagement
    && engagement.organizationId === organizationId
    && engagement.clientApproverUserId === actorUserId
  );
}

/**
 * A display name is mutable and is never proof that a separate human
 * performed payroll checker approval. Historic evidence without an
 * authenticated numeric deciderUserId must fail closed.
 */
export function classifyManagedPayrollCheckerIdentity(
  evidenceDeciderUserId: unknown,
  clientApproverUserId: number,
): "unknown" | "same_user" | "independent" {
  if (typeof evidenceDeciderUserId !== "number"
    || !Number.isSafeInteger(evidenceDeciderUserId)
    || evidenceDeciderUserId < 1
    || !Number.isSafeInteger(clientApproverUserId)
    || clientApproverUserId < 1) return "unknown";
  return evidenceDeciderUserId === clientApproverUserId ? "same_user" : "independent";
}
