/**
 * Client-only guards for the WFM Live Floor.
 *
 * A valid server response can still belong to an older tenant/page request.
 * Keep the scoped snapshot hidden until the active render scope matches, and
 * never commit results from an aborted or superseded fetch.
 */
export type ScopedLiveFloorSnapshot<T> = Readonly<{
  scopeKey: string;
  data: T;
}>;

export function liveFloorScopeKey(organizationId: number, page: number): string {
  return `${organizationId}:${page}`;
}

export function activeLiveFloorSnapshot<T>(
  stored: ScopedLiveFloorSnapshot<T> | null,
  activeScopeKey: string,
): T | null {
  return stored?.scopeKey === activeScopeKey ? stored.data : null;
}

export function isCurrentLiveFloorRequest(
  controller: AbortController,
  activeController: AbortController | null,
): boolean {
  return activeController === controller && !controller.signal.aborted;
}
