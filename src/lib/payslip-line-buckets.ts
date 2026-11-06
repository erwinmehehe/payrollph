/**
 * Which payslip section a stored payroll line belongs to: earnings (adds up to stored gross) or
 * deductions (adds up to stored deductions). Lines are classified by economic bucket, not by sign:
 *
 * - A year-end tax refund is stored as a positive `YE-TAX-<id>` line, but it is not compensation. Gross
 *   excludes it and stored deductions are netted by it, so it is shown as a credit (negative amount) in
 *   the deductions section.
 * - Unpaid leave (`LEAVE-<id>`) and negative retro pay reduce gross, so they stay in earnings even when negative.
 *
 * Unknown codes fall back to the sign (positive = earning, negative = deduction). Zero lines are not shown.
 * The stored line amounts and signs are unchanged; journal, settlement and BIR 2316 code read them by code.
 */
export type PayslipLineLike = { code?: string | null; amount?: string | number | null };
export type PayslipBucket = "earning" | "deduction";

const DEDUCTION_CODES = new Set(["SSS", "PHIC", "HDMF", "HDMF_VOL", "WHT", "LATE", "UT", "YE-TAX"]);
const DEDUCTION_PREFIXES = ["YE-TAX-", "LOAN-", "EWA-", "ADV-", "BEN-"];
const EARNING_ADJUSTMENT_PREFIXES = ["LEAVE-", "RETRO-"];

function amountOf(line: PayslipLineLike) {
  const amount = Number(line.amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function payslipLineBucket(line: PayslipLineLike): PayslipBucket | null {
  const amount = amountOf(line);
  if (amount === 0) return null;
  const code = String(line.code ?? "").toUpperCase();
  if (DEDUCTION_CODES.has(code) || DEDUCTION_PREFIXES.some((prefix) => code.startsWith(prefix))) return "deduction";
  if (EARNING_ADJUSTMENT_PREFIXES.some((prefix) => code.startsWith(prefix))) return "earning";
  return amount > 0 ? "earning" : "deduction";
}

export function splitPayslipLines<T extends PayslipLineLike>(lines: readonly T[]) {
  const earnings: T[] = [];
  const deductions: T[] = [];
  for (const line of lines) {
    const bucket = payslipLineBucket(line);
    if (bucket === "earning") earnings.push(line);
    else if (bucket === "deduction") deductions.push(line);
  }
  return { earnings, deductions };
}

/** Amount to print in the deductions section: positive for money withheld, negative for a credit such as a tax refund. */
export function deductionDisplayAmount(line: PayslipLineLike) {
  const amount = -amountOf(line);
  return amount === 0 ? 0 : amount;
}

/** Section totals in pesos, summed in integer centavos so they compare exactly with stored gross and deductions. */
export function payslipSectionTotals(lines: readonly PayslipLineLike[]) {
  const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
  const { earnings, deductions } = splitPayslipLines(lines);
  return {
    earnings: earnings.reduce((sum, line) => sum + cents(amountOf(line)), 0) / 100,
    deductions: deductions.reduce((sum, line) => sum + cents(deductionDisplayAmount(line)), 0) / 100,
  };
}
