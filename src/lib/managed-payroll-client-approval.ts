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
