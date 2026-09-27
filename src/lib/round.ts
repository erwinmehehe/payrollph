/** Shared money rounding so every module rounds the same way. */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
