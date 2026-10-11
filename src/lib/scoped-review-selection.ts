export type ScopedReviewSelection = Readonly<{ scopeKey: string; ids: ReadonlySet<number> }>;

/** Only currently pending rows in the current employer/access scope may be reviewed. */
export function pendingReviewSelection(
  selection: ScopedReviewSelection | null,
  scopeKey: string,
  rows: ReadonlyArray<{ id: number; status: string }>,
): Set<number> {
  if (selection?.scopeKey !== scopeKey) return new Set();
  return new Set(rows.filter((row) => row.status === "pending" && selection.ids.has(row.id)).map((row) => row.id));
}
