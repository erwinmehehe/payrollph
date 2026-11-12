/**
 * Parse one explicitly selected employer for server-rendered page routes.
 * URL query parameter arrays (including duplicates), normalized numeric
 * spellings and unsafe integers are never accepted as tenant selectors.
 */
export function canonicalTenantPageId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
