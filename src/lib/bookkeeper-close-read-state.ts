/**
 * An accounting close response belongs to one exact employer/run/read revision.
 * A previous payroll's close eligibility and filing evidence must never remain
 * visible while another run or employer is loading.
 */
export type BookkeeperCloseRead<T> = Readonly<{
  requestKey: string;
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
  requestKey: string,
  observed: BookkeeperCloseRead<T> | null,
): { loading: boolean; payload: T | null; loadError: string } {
  if (!observed || observed.requestKey !== requestKey) {
    return { loading: true, payload: null, loadError: "" };
  }
  return { loading: false, payload: observed.payload, loadError: observed.loadError };
}
