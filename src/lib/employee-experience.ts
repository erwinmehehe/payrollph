export const ONE_ON_ONE_CADENCES = ["weekly", "biweekly", "monthly", "quarterly"] as const;
export type OneOnOneCadence = (typeof ONE_ON_ONE_CADENCES)[number];

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function nextCadenceDate(dateText: string, cadence: OneOnOneCadence) {
  if (!isIsoDate(dateText)) throw new Error("Invalid one-on-one date.");
  const value = new Date(dateText + "T00:00:00Z");
  if (cadence === "weekly" || cadence === "biweekly") {
    value.setUTCDate(value.getUTCDate() + (cadence === "weekly" ? 7 : 14));
    return value.toISOString().slice(0, 10);
  }

  const months = cadence === "monthly" ? 1 : 3;
  const originalDay = value.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
  const targetMonthEnd = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0));
  const targetDay = Math.min(originalDay, targetMonthEnd.getUTCDate());
  return new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), targetDay))
    .toISOString()
    .slice(0, 10);
}

export function boundedProgress(value: unknown) {
  const progress = Number(value);
  return Number.isInteger(progress) && progress >= 0 && progress <= 100 ? progress : null;
}

export function reviewScore(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 5 ? number.toFixed(2) : null;
}
