/** Runtime input checks for pure advisory calculations; never coerces missing records. */
export function requireStatutoryRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError(`${label} must be an object`);
  }
}

export function statutoryNumber(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} must be a finite non-negative number within the supported range`);
  }
  return value;
}

export function statutoryDays(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function optionalStatutoryDays(value: unknown, label: string): number {
  return statutoryDays(value === undefined ? 0 : value, label);
}

export function statutoryBoolean(value: unknown, label: string, optional = false): void {
  if (optional && value === undefined) return;
  if (typeof value !== "boolean") throw new RangeError(`${label} must be a boolean`);
}

/** Keep both monetary inputs and derived results within safe centavo magnitude. */
export function statutoryAmount(value: unknown, label: string): number {
  return statutoryNumber(value, label, Number.MAX_SAFE_INTEGER / 100);
}

export function statutoryOffset(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
  return value;
}
