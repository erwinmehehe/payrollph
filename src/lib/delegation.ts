import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { approvalDelegations, userOrganizations } from "@/db/schema";

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Resolves who may actually decide an approval right now.
 * Returns the original approver plus any active delegate chain (max depth 3 to avoid cycles).
 */
export type ApprovalDelegationEdge = {
  fromApprover: string;
  toApprover: string;
  reason: string;
};

/**
 * Shared snapshot resolver. Decisions and home previews must follow the same
 * first-matching delegation chain (maximum three links, cycle-protected).
 */
export function resolveApproversFromRows(
  approver: string,
  delegations: readonly ApprovalDelegationEdge[],
) {
  const chain: Array<{ from: string; to: string; reason: string }> = [];
  const seen = new Set([approver.toLowerCase()]);
  let current = approver;

  for (let depth = 0; depth < 3; depth += 1) {
    const match = delegations.find((row) => row.fromApprover.toLowerCase() === current.toLowerCase());
    if (!match) break;
    if (seen.has(match.toApprover.toLowerCase())) break;
    chain.push({ from: match.fromApprover, to: match.toApprover, reason: match.reason });
    seen.add(match.toApprover.toLowerCase());
    current = match.toApprover;
  }

  return {
    originalApprover: approver,
    effectiveApprover: current,
    delegated: chain.length > 0,
    chain,
    allowed: Array.from(seen),
  };
}

/** Authoritative approval flow retains the original active-dates query. */
export async function resolveEffectiveApprovers(organizationId: number, approver: string, onDate = today()) {
  const delegations = await db.select().from(approvalDelegations).where(and(
    eq(approvalDelegations.organizationId, organizationId),
    eq(approvalDelegations.active, true),
    lte(approvalDelegations.startsOn, onDate),
    gte(approvalDelegations.endsOn, onDate),
  ));
  return resolveApproversFromRows(approver, delegations);
}

const ROLE_APPROVER_GROUPS: Record<string, readonly string[]> = {
  "role:hr": ["hr", "admin", "owner"],
  "role:finance": ["bookkeeper", "admin", "owner"],
  "role:owner": ["owner"],
  "role:manager": ["manager", "admin", "owner"],
};

export function roleApproverMatchesRole(approver: string, role: string) {
  const acceptedRoles = ROLE_APPROVER_GROUPS[approver.trim().toLowerCase()] ?? null;
  return acceptedRoles ? acceptedRoles.includes(role) : false;
}

export async function canDecide(
  organizationId: number,
  approver: string,
  actor: string,
  actorUserId?: number | null,
) {
  const normalizedApprover = approver.trim().toLowerCase();
  const acceptedRoles = ROLE_APPROVER_GROUPS[normalizedApprover] ?? null;
  let roleMatched = false;
  let actorRole: string | null = null;

  if (acceptedRoles && actorUserId && Number.isInteger(actorUserId)) {
    const [membership] = await db.select({
      role: userOrganizations.role,
    }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, actorUserId),
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
    )).limit(1);
    actorRole = membership?.role ?? null;
    roleMatched = actorRole != null && roleApproverMatchesRole(approver, actorRole);
  }

  const resolved = await resolveEffectiveApprovers(organizationId, approver);
  return {
    ...resolved,
    roleTarget: acceptedRoles ? normalizedApprover : null,
    actorRole,
    roleMatched,
    permitted: roleMatched || resolved.allowed.includes(actor.toLowerCase()),
  };
}


/**
 * Read-only HCM Home check, preserving the actual canDecide semantics.
 * The caller must have already enforced tenant, company-wide role and custom
 * permissions. No application approval is decided by this helper.
 */
export function canPreviewHcmAssignment(
  assignee: string,
  actorName: string,
  actorRole: string | null,
  delegations: readonly ApprovalDelegationEdge[],
): boolean {
  const resolved = resolveApproversFromRows(assignee, delegations);
  return (actorRole !== null && roleApproverMatchesRole(assignee, actorRole)) ||
    resolved.allowed.includes(actorName.toLowerCase());
}

const PEOPLE_HOME_DELEGATION_LIMIT = 250;

/**
 * Two tenant-qualified, capped snapshot queries, not 2 queries per step.
 * Passing null asks for possible identity/role/delegated assignees BEFORE
 * the worklist's SQL LIMIT. This is not wildcard access: every target is
 * checked against the same canonical preview permission resolver.
 */
export async function loadPeopleHomeAssigneePermissions(
  organizationId: number,
  assignees: readonly string[] | null,
  actor: { id: number; name: string },
): Promise<Map<string, boolean>> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(actor.id) || actor.id <= 0) {
    throw new Error("Valid actor and employer required.");
  }
  const onDate = today();
  const [memberships, delegations] = await Promise.all([
    db.select({ role: userOrganizations.role })
      .from(userOrganizations).where(and(
        eq(userOrganizations.userId, actor.id),
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.active, true),
      )).limit(1),
    db.select({
      fromApprover: approvalDelegations.fromApprover,
      toApprover: approvalDelegations.toApprover,
      reason: approvalDelegations.reason,
    }).from(approvalDelegations).where(and(
      eq(approvalDelegations.organizationId, organizationId),
      eq(approvalDelegations.active, true),
      lte(approvalDelegations.startsOn, onDate),
      gte(approvalDelegations.endsOn, onDate),
    )).limit(PEOPLE_HOME_DELEGATION_LIMIT + 1),
  ]);
  // If the employer has more delegations than this safe snapshot limit, do
  // not guess who can decide: the People Home source is marked unavailable.
  if (delegations.length > PEOPLE_HOME_DELEGATION_LIMIT) {
    throw new Error("People Home delegation preview requires source review.");
  }
  const actorRole = memberships[0]?.role ?? null;
  // canDecide allows the actor directly, an eligible role, or up to three
  // active delegation links. Only original delegation sources can name
  // additional workflow assignees; their reachability is verified below.
  const candidates = assignees ?? [
    actor.name,
    ...Object.keys(ROLE_APPROVER_GROUPS),
    ...delegations.map((row) => row.fromApprover),
  ];
  return new Map(Array.from(new Set(candidates)).map((assignee) => [
    assignee,
    canPreviewHcmAssignment(assignee, actor.name, actorRole, delegations),
  ]));
}
