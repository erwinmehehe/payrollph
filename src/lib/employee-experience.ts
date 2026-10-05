export const ONE_ON_ONE_CADENCES = ["weekly", "biweekly", "monthly", "quarterly"] as const;
export type OneOnOneCadence = (typeof ONE_ON_ONE_CADENCES)[number];

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function nextCadenceDate(dateText: string, cadence: OneOnOneCadence) {
  const value = new Date(dateText + "T00:00:00Z");
  if (Number.isNaN(value.getTime())) throw new Error("Invalid one-on-one date.");

  if (cadence === "weekly") value.setUTCDate(value.getUTCDate() + 7);
  if (cadence === "biweekly") value.setUTCDate(value.getUTCDate() + 14);
  if (cadence === "monthly") value.setUTCMonth(value.getUTCMonth() + 1);
  if (cadence === "quarterly") value.setUTCMonth(value.getUTCMonth() + 3);

  return value.toISOString().slice(0, 10);
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
