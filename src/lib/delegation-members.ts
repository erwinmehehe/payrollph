/**
 * Delegations persist display names instead of user IDs. A caller must pass
 * ONLY active memberships already scoped to the requested organization/unit.
 * Ambiguous names cannot be accepted as an authorization identity.
 */
export function uniqueDelegationMember<T extends { name: string }>(
  members: readonly T[],
  requestedName: string,
): T | null {
  const key = requestedName.trim().toLowerCase();
  if (!key) return null;
  const matches = members.filter((member) => member.name.trim().toLowerCase() === key);
  return matches.length === 1 ? matches[0] : null;
}
