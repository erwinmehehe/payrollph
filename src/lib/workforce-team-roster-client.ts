/**
 * Scope weekly workforce views by the full authorized roster query.
 * An old tenant/week/search/page result must not be rendered or exported when
 * props or filters change before the replacement fetch completes.
 */
export type ScopedTeamRosterPayload<T> = Readonly<{
  scopeKey: string;
  data: T;
}>;

export function teamRosterScopeKey(
  organizationId: number,
  startDate: string,
  page: number,
  search: string,
): string {
  return JSON.stringify([organizationId, startDate, page, search]);
}

export function activeTeamRosterPayload<T>(
  stored: ScopedTeamRosterPayload<T> | null,
  activeScopeKey: string,
): T | null {
  return stored?.scopeKey === activeScopeKey ? stored.data : null;
}
