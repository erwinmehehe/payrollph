/**
 * Page-level tenant selector for the HCM work queue.
 * No implicit employer fallback and no coercion of repeated or malformed ids.
 */
export function parseHcmWorkItemsEmployerId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
