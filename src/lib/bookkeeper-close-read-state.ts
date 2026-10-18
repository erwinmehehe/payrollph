/**
 * An accounting close response belongs to one exact employer/run/read revision.
 * A previous payroll's close eligibility and filing evidence must never remain
 * visible while another run or employer is loading.
 */
export type BookkeeperCloseScope = Readonly<{ requestKey: string }>;

export type BookkeeperCloseRead<T> = Readonly<{
  requestScope: BookkeeperCloseScope;
  payload: T | null;
  loadError: string;
}>;

export function bookkeeperCloseRequestKey(input: {
  organizationId: number;
  runId: number;
  auditEventCount: number;
  reloadKey: number;
}): string {
  return JSON.stringify([
    input.organizationId,
    input.runId,
    input.auditEventCount,
    input.reloadKey,
  ]);
}

export function visibleBookkeeperCloseRead<T>(
  requestScope: BookkeeperCloseScope,
  observed: BookkeeperCloseRead<T> | null,
): { loading: boolean; payload: T | null; loadError: string } {
  // A -> B -> A creates a new scope object; never reuse the first A response.
  if (!observed || observed.requestScope !== requestScope) {
    return { loading: true, payload: null, loadError: "" };
  }
  return { loading: false, payload: observed.payload, loadError: observed.loadError };
}
