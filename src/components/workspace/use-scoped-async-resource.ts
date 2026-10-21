"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { activeAsyncResult, createScopedRequestOwner, type ScopedAsyncResult } from "@/lib/scoped-async-request";

/** Fetch only in effects/events; derive first-load visibility from the render scope. */
export function useScopedAsyncResource<T>(
  scopeKey: string,
  load: (signal: AbortSignal) => Promise<T>,
  onError?: (error: Error) => void,
  enabled = true,
) {
  const key = useMemo(() => ({ scopeKey, load, onError, enabled }), [scopeKey, load, onError, enabled]);
  const [owner] = useState(() => createScopedRequestOwner<typeof key>());
  const [settled, setSettled] = useState<ScopedAsyncResult<typeof key, T> | null>(null);
  const [refreshing, setRefreshing] = useState<typeof key | null>(null);

  const run = useCallback(() => {
    if (!key.enabled) return Promise.resolve(undefined);
    return owner.run(key, key.load, (outcome) => {
      setSettled({ key, ...outcome });
      setRefreshing(null);
      if (outcome.error) key.onError?.(outcome.error);
    });
  }, [key, owner, setSettled, setRefreshing]);

  // Cancel ownership during commit, before an obsolete response can emit a notice.
  useLayoutEffect(() => {
    owner.activate(key);
    return () => owner.cancel(key);
  }, [key, owner]);

  useEffect(() => {
    void run();
  }, [run]);

  // Called by explicit refresh/mutation handlers, never by the mount effect.
  const reload = useCallback(() => {
    if (!key.enabled || !owner.isActive(key)) return Promise.resolve(undefined);
    setRefreshing(key);
    return run();
  }, [key, owner, run, setRefreshing]);

  const active = activeAsyncResult(settled, key, enabled);
  const loading = enabled && (!active || refreshing === key);
  const isCurrent = useCallback(() => key.enabled && owner.isActive(key), [key, owner]);
  return { data: loading ? null : active?.data ?? null, error: loading ? null : active?.error ?? null, loading, reload, isCurrent };
}
