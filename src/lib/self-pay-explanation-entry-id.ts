/**
 * Canonical resource-ID parser for the employee-only Explain My Pay read.
 * The route handles missing, malformed, foreign and out-of-range IDs through
 * the same non-cacheable 404. Never coerce a numeric alias or a signed value.
 */
export function parseSelfPayExplanationEntryId(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
