/**
 * Prevent duplicate notifications from repeated async failures from
 * covering the app. This is a presentation-only queue; it never suppresses
 * error state on the component that made the request.
 */
export const MAX_VISIBLE_TOASTS = 4;

export function appendDistinctToast<T extends { id: number; kind: string; message: string }>(
  current: T[],
  next: T,
  limit = MAX_VISIBLE_TOASTS,
): T[] {
  if (current.some((item) => item.kind === next.kind && item.message === next.message)) {
    return current;
  }
  const cap = Math.max(1, Math.trunc(limit) || 1);
  return [...current, next].slice(-cap);
}
