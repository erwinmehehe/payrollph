/**
 * Focus wraps only at the ends of the currently visible mobile drawer buttons.
 * This is a UI-only decision; caller must derive controls from already role-scoped nav.
 */
export function wrapWorkspaceDrawerTabIndex(
  activeIndex: number, count: number, shiftKey: boolean,
): number | null {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  if (shiftKey && activeIndex <= 0) return count - 1;
  if (!shiftKey && (activeIndex < 0 || activeIndex >= count - 1)) return 0;
  return null;
}
