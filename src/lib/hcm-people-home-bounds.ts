import type { HcmHomeItem } from "@/lib/hcm-people-home-projection";

export const HCM_PEOPLE_HOME_DECISION_LIMIT = 40;
export const HCM_PEOPLE_HOME_DELEGATION_LIMIT = 300;
export const HCM_PEOPLE_HOME_FOLLOWUP_LIMIT = 12;
export const HCM_PEOPLE_HOME_CASE_LIMIT = 40;

export type HcmPeopleHomeSlice = {
  status: "ready" | "unavailable";
  items: HcmHomeItem[];
  partial: boolean;
  hasMore: boolean | null;
};

export function unavailablePeopleHomeSlice(): HcmPeopleHomeSlice {
  return { status: "unavailable", items: [], partial: true, hasMore: null };
}

export function boundedPeopleHomeRows<T>(rows: readonly T[], limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid preview limit");
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** Mirrors canDecide's three-hop, case-insensitive delegation resolution. */
export function delegatedHcmAssigneeMatches(
  assignee: string,
  actorName: string,
  delegations: readonly { fromApprover: string; toApprover: string }[],
): boolean {
  const seen = new Set([assignee.toLowerCase()]);
  let current = assignee;
  for (let depth = 0; depth < 3; depth += 1) {
    const edge = delegations.find((row) => row.fromApprover.toLowerCase() === current.toLowerCase());
    if (!edge || seen.has(edge.toApprover.toLowerCase())) break;
    seen.add(edge.toApprover.toLowerCase());
    current = edge.toApprover;
  }
  return seen.has(actorName.toLowerCase());
}

/**
 * Create the named-assignee SQL filter before selecting pending BP steps.
 * The caller must supply only active, tenant-scoped delegation edges and reject
 * ambiguous duplicate 'from' edges as the preview server already does.
 *
 * This matches canDecide's direct-name and <=3-hop delegate semantics, while
 * keeping out other users' tasks BEFORE applying the page ceiling.
 */
export function allowedDelegatedHcmAssigneeNames(
  actorName: string,
  delegations: readonly { fromApprover: string; toApprover: string }[],
): string[] {
  const allowed = new Set<string>([actorName.toLowerCase()]);
  for (const delegation of delegations) {
    if (delegatedHcmAssigneeMatches(delegation.fromApprover, actorName, delegations)) {
      allowed.add(delegation.fromApprover.toLowerCase());
    }
  }
  return [...allowed];
}
