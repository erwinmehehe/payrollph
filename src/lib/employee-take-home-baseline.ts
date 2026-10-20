import type { TakeHomeEstimate } from "./take-home-estimate";

/** A successful HTTP status is not proof that this private payroll read is usable. */
export type EmployeeTakeHomeBaselinePayload = {
  asOf: string;
  baseline: { monthlyBasic: number; payBasis: string; mwe: boolean };
  estimate: TakeHomeEstimate;
  note: string;
};

const AMOUNT_FIELDS = [
  "monthlyBasic", "taxableAllowances", "nonTaxableAllowances", "gross",
  "sss", "philHealth", "pagIbig", "voluntaryPagIbig",
  "taxableCompensation", "withholdingTax", "totalDeductions", "netPay",
] as const satisfies readonly (keyof TakeHomeEstimate)[];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const nearCentavo = (a: number, b: number) => Math.abs(a - b) <= 0.021;

/**
 * Check the minimum private response contract BEFORE putting it into React state.
 * Missing, nonnumeric, contradictory or forged-looking amounts must never show as
 * a real employee's pay estimate. No network calls or server record writes.
 */
export function parseEmployeeTakeHomeBaseline(input: unknown): EmployeeTakeHomeBaselinePayload | null {
  if (!record(input) || !record(input.baseline) || !record(input.estimate) ||
      !validDate(input.asOf) || typeof input.note !== "string" ||
      input.note.length === 0 || input.note.length > 5000) return null;

  const baseline = input.baseline;
  const estimate = input.estimate;
  if (typeof baseline.monthlyBasic !== "number" ||
      !Number.isFinite(baseline.monthlyBasic) ||
      baseline.monthlyBasic < 0 || baseline.monthlyBasic > 100_000_000 ||
      typeof baseline.mwe !== "boolean" ||
      typeof baseline.payBasis !== "string" ||
      baseline.payBasis.length === 0 || baseline.payBasis.length > 64) return null;

  for (const field of AMOUNT_FIELDS) {
    const value = estimate[field];
    if (typeof value !== "number" || !Number.isFinite(value) ||
        Math.abs(value) > 300_000_000 ||
        (field !== "netPay" && value < 0)) return null;
  }

  const amounts = estimate as Record<(typeof AMOUNT_FIELDS)[number], number>;
  if (!nearCentavo(amounts.monthlyBasic, Math.round(baseline.monthlyBasic * 100) / 100) ||
      !nearCentavo(amounts.gross,
        amounts.monthlyBasic + amounts.taxableAllowances + amounts.nonTaxableAllowances) ||
      !nearCentavo(amounts.totalDeductions,
        amounts.sss + amounts.philHealth + amounts.pagIbig +
        amounts.voluntaryPagIbig + amounts.withholdingTax) ||
      !nearCentavo(amounts.netPay, amounts.gross - amounts.totalDeductions)) return null;

  return input as EmployeeTakeHomeBaselinePayload;
}

/** Never render arbitrary response.error values (or label corrupt JSON as a network outage). */
export function employeeTakeHomeReadError(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again to view your pay estimate.";
  if (status === 403) return "This account cannot view an employee pay baseline. Contact HR.";
  if (status === 404) return "Your employee pay record was not found. Contact HR.";
  if (status === 409) return "Your pay profile is not set up yet. Ask HR or payroll to complete it.";
  return "We could not load your pay baseline.";
}
