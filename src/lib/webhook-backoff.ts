/** Exponential backoff between webhook delivery attempts: 1m, 5m, 25m, 125m. */
export const BACKOFF_SCHEDULE_MS = [60_000, 300_000, 1_500_000, 7_500_000];

export function nextBackoffMs(attempts: number) {
  return BACKOFF_SCHEDULE_MS[Math.min(Math.max(attempts, 1) - 1, BACKOFF_SCHEDULE_MS.length - 1)];
}
