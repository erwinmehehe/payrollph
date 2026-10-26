/** Strict, organization-bound accounting labels, never salary or payroll rules. */
export const LABOR_VERTICAL_DIMENSION_KEYS = [
  "campaignCode", "siteCode", "teamCode",
  "plantCode", "lineCode", "shiftCode",
  "propertyCode", "departmentCode", "eventCode",
] as const;
export const LABOR_VERTICAL_DIMENSION_HEADERS = [
  "Campaign", "Site", "Team", "Plant", "Line", "Shift",
  "Property", "Department", "Event",
] as const;
export type LaborVerticalDimensionKey = (typeof LABOR_VERTICAL_DIMENSION_KEYS)[number];
export type LaborVerticalDimensions = Partial<Record<LaborVerticalDimensionKey, string>>;

const allowed = new Set<string>(LABOR_VERTICAL_DIMENSION_KEYS);
const codePattern = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/;

export function normalizeLaborVerticalDimensions(raw: unknown): LaborVerticalDimensions | null {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Labor vertical dimensions must be a plain object.");
  }
  if (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) {
    throw new Error("Labor vertical dimensions must be a plain object.");
  }
  const entries = Object.entries(raw);
  if (entries.length > LABOR_VERTICAL_DIMENSION_KEYS.length) {
    throw new Error("Too many labor vertical dimension keys.");
  }
  const normalized: LaborVerticalDimensions = {};
  for (const [key, value] of entries) {
    if (!allowed.has(key)) throw new Error("Unsupported labor vertical dimension: " + key);
    if (typeof value !== "string") throw new Error("Labor vertical dimension " + key + " must be a code string.");
    const code = value.trim().toUpperCase();
    if (!codePattern.test(code)) {
      throw new Error("Labor vertical dimension " + key + " must be an ASCII code of 1-64 characters.");
    }
    normalized[key as LaborVerticalDimensionKey] = code;
  }
  return entries.length ? normalized : null;
}

export function laborVerticalDimensionValues(raw: LaborVerticalDimensions | null | undefined): string[] {
  return LABOR_VERTICAL_DIMENSION_KEYS.map(key => raw?.[key] ?? "");
}

/**
 * Only employee allocations effective at this run's costing date may change
 * its journal CSV contract. A future, expired, or unrelated employee's tag must
 * never add columns to an older export that was still legacy-shaped.
 */
export function journalRequiresVerticalDimensionColumns(input: {
  allocations: ReadonlyArray<{
    employeeId: number;
    effectiveFrom: string;
    effectiveUntil: string | null;
    verticalDimensions: unknown;
  }>;
  employeeIds: ReadonlySet<number>;
  asOf: string;
}): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
    throw new Error("Journal costing date must be an ISO date.");
  }
  return input.allocations.some((row) =>
    input.employeeIds.has(row.employeeId)
    && row.effectiveFrom <= input.asOf
    && (!row.effectiveUntil || input.asOf <= row.effectiveUntil)
    && normalizeLaborVerticalDimensions(row.verticalDimensions) !== null,
  );
}
