/**
 * Runtime boundary shared by the read-only HCM team and leave loaders.
 * TypeScript unions disappear at runtime. A scope with an unknown kind must
 * never silently fall into the unfiltered company-wide SQL branch.
 */
export type HcmReadScope =
  | { kind: "company"; orgUnitId: null }
  | { kind: "unit"; orgUnitId: number };

export function isValidHcmReadScope(value: unknown): value is HcmReadScope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const scope = value as Record<string, unknown>;
  if (scope.kind === "company") return scope.orgUnitId === null;
  return scope.kind === "unit" &&
    typeof scope.orgUnitId === "number" &&
    Number.isSafeInteger(scope.orgUnitId) &&
    scope.orgUnitId > 0;
}
