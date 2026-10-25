/**
 * Fail-closed legal-employer selector reconciliation.
 *
 * An explicit body argument, x-legal-entity-id header and URL query are all
 * untrusted selectors. No source may silently override a different source:
 * otherwise a downstream query could use an ID the authorization layer did
 * not actually authorize. This module is deliberately DB- and flag-free.
 */
export type ExplicitEntitySelector =
  | { ok: true; requested: number | "all" | undefined; explicit: boolean }
  | { ok: false; code: "ENTITY_SELECTOR_INVALID" | "ENTITY_SELECTOR_CONFLICT" };

function canonicalSelector(value: unknown): number | "all" | undefined {
  if (value === null || value === "all") return "all";
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  // Number("0xB"), Number("1e3"), whitespace and a leading zero are not
  // canonical IDs. Do not accept them merely because Number() is permissive.
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function resolveExplicitEntitySelection(input: {
  requested?: unknown;
  header?: string | null;
  queryValues?: readonly string[];
}): ExplicitEntitySelector {
  const queryValues = input.queryValues ?? [];
  // get("legalEntityId") alone would silently ignore repeated, conflicting
  // query parameters. Even repeated identical selectors are malformed.
  if (queryValues.length > 1) return { ok: false, code: "ENTITY_SELECTOR_INVALID" };
  const values: unknown[] = [];
  if (input.requested !== undefined) values.push(input.requested);
  if (input.header !== null && input.header !== undefined) values.push(input.header);
  if (queryValues.length === 1) values.push(queryValues[0]);
  if (values.length === 0) return { ok: true, requested: undefined, explicit: false };

  const first = canonicalSelector(values[0]);
  if (first === undefined) return { ok: false, code: "ENTITY_SELECTOR_INVALID" };
  for (const value of values.slice(1)) {
    const next = canonicalSelector(value);
    if (next === undefined) return { ok: false, code: "ENTITY_SELECTOR_INVALID" };
    if (next !== first) return { ok: false, code: "ENTITY_SELECTOR_CONFLICT" };
  }
  return { ok: true, requested: first, explicit: true };
}
