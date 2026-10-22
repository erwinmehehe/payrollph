export type RequestOutcome<T> =
  | { data: T; error: null }
  | { data: null; error: Error };

export type ScopedAsyncResult<K, T> = RequestOutcome<T> & { key: K };

/** Hide a previous scope immediately, including before effect cleanup runs. */
export function activeAsyncResult<K, T>(
  result: ScopedAsyncResult<K, T> | null,
  key: K,
  enabled: boolean,
): ScopedAsyncResult<K, T> | null {
  return enabled && result?.key === key ? result : null;
}

/** Per-mounted-view ownership, never shared between users or tenants. */
export function createScopedRequestOwner<K>() {
  let activeKey: K | null = null;
  let pending: AbortController | null = null;

  function cancel(key: K) {
    if (activeKey !== key) return;
    pending?.abort();
    pending = null;
    activeKey = null;
  }

  return {
    isActive(key: K) {
      return activeKey === key;
    },
    activate(key: K) {
      pending?.abort();
      pending = null;
      activeKey = key;
    },
    cancel,
    async run<T>(key: K, load: (signal: AbortSignal) => Promise<T>, commit: (outcome: RequestOutcome<T>) => void) {
      // A mutation completing in an old view must not cancel the new fetch.
      if (activeKey !== key) return;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      let outcome: RequestOutcome<T>;
      try {
        outcome = { data: await load(controller.signal), error: null };
      } catch (error) {
        outcome = { data: null, error: error instanceof Error ? error : new Error("Request failed.") };
      }
      // Some transports still resolve after abort; ownership is decisive.
      if (activeKey !== key || pending !== controller || controller.signal.aborted) return;
      pending = null;
      commit(outcome);
      return outcome;
    },
  };
}
