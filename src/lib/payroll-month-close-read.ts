/**
 * A month-close certificate is visibility-scoped to one employer, month and
 * explicit refresh. The backend independently controls certification.
 *
 * Using the memoized request scope by identity (not only its values) means
 * returning A -> B -> A never shows an obsolete A certificate while loading.
 */
export type MonthCloseScope = Readonly<{
  organizationId: number;
  month: string;
  revision: number;
}>;

export type MonthCloseObserved<T> = Readonly<{
  scope: MonthCloseScope;
  payload: T | null;
  error: string;
}>;

export function visibleMonthCloseRead<T>(
  scope: MonthCloseScope,
  observed: MonthCloseObserved<T> | null,
): { state: T | null; loading: boolean; error: string } {
  if (!observed || observed.scope !== scope) {
    return { state: null, loading: true, error: "" };
  }
  return { state: observed.payload, loading: false, error: observed.error };
}
