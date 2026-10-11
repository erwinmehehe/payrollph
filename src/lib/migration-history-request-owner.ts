/**
 * Read-only import-history request owner for a single employer workspace view.
 * A response from a retired view or an earlier refresh must never populate
 * another tenant's history, even if the transport ignores AbortSignal.
 *
 * This does not cancel a submitted migration write or claim it was rolled back.
 */
export type MigrationHistoryResult =
  | { state: "ready"; batches: unknown[] }
  | { state: "unavailable" };

type HistoryResponse = Pick<Response, "ok" | "json">;
type HistoryFetch = (url: string, init: { cache: "no-store"; signal: AbortSignal }) => Promise<HistoryResponse>;

export function createMigrationHistoryReader(
  organizationId: number,
  request: HistoryFetch,
  onResult: (result: MigrationHistoryResult) => void,
) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Valid migration employer scope is required.");
  }

  let retired = false;
  let generation = 0;
  let current: AbortController | null = null;

  return {
    isCurrent() { return !retired; },

    async refresh(): Promise<boolean> {
      if (retired) return false;
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const requestGeneration = ++generation;

      const mayPublish = () =>
        !retired && requestGeneration === generation && !controller.signal.aborted;

      try {
        const response = await request(
          `/api/migrations?organizationId=${organizationId}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("Migration history HTTP request failed");
        const value: unknown = await response.json();
        if (!mayPublish()) return false;

        if (!value || typeof value !== "object"
          || !Array.isArray((value as { batches?: unknown }).batches)) {
          onResult({ state: "unavailable" });
          return false;
        }
        onResult({ state: "ready", batches: (value as { batches: unknown[] }).batches });
        return true;
      } catch {
        // Aborts and older requests are expected during tenant/view changes.
        if (mayPublish()) onResult({ state: "unavailable" });
        return false;
      } finally {
        if (current === controller) current = null;
      }
    },

    retire() {
      retired = true;
      generation += 1;
      current?.abort();
      current = null;
    },
  };
}
