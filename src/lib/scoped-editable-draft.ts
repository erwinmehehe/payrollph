export type ScopedEditableDraft<T> = Readonly<{ source: T; value: T }>;

/** A draft belongs to one fetched result, not just to an employer ID. */
export function currentEditableValue<T>(draft: ScopedEditableDraft<T> | null, source: T | null): T | null {
  if (source === null) return null;
  return draft?.source === source ? draft.value : source;
}
