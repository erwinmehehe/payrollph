/**
 * Quarterly expanded-withholding (EWT) payee schedule for contractor payments: the shared source for BIR Form 2307
 * (one certificate per payee per quarter, income by ATC and by month of the quarter) and for the quarterly alphalist of
 * payees that accompanies BIR Form 1601-EQ.
 *
 * The contractor payments API already stores, per payment, the ATC, the rate (in percent) and the amount withheld, and it
 * already produces per-ATC 0619-E / 1601-EQ source totals. What it does not produce is the per-PAYEE breakdown both forms
 * need. This module builds that breakdown and refuses to present it as reviewable when anything is wrong:
 *
 *   - a payment outside the quarter, or an amount that is not an exact centavo value;
 *   - a withheld amount that is not round2(gross x rate / 100), the formula the payments API uses;
 *   - a payee without a valid 9-digit TIN (the TIN branch code is not stored, so it is always left for a person);
 *   - a payee outside the Philippines, whose withholding may be a final tax on a different return (1601-FQ), not EWT.
 *
 * It does NOT validate ATCs or rates against the BIR schedule, produce a certificate, or produce a DAT file: the official
 * QAP / 1604-E file layouts are not in this repository, and an ATC/rate table is a legal reading. It is pure (no database,
 * file, network or environment access) and consumed only by the separately authorized, read-only EWT quarter API.
 */

export type EwtPayment = {
  id: number;
  contractorId: number;
  paymentDate: string;
  grossAmountPhp: number | string;
  withholdingAtc: string;
  withholdingRate: number | string;
  withholdingAmount: number | string;
};
export type EwtPayee = { id: number; name: string; tin: string | null; country: string | null };

export type EwtPayeeLine = {
  atc: string;
  ratePercent: string;
  /** Income payments in month 1, 2 and 3 of the quarter, as two-decimal strings. */
  months: [string, string, string];
  totalIncome: string;
  taxWithheld: string;
  paymentIds: number[];
};
export type EwtPayeeSchedule = {
  contractorId: number;
  name: string;
  tin: string | null;
  lines: EwtPayeeLine[];
  totalIncome: string;
  totalTaxWithheld: string;
};
export type EwtQuarterSchedule = {
  quarter: string;
  period: { start: string; end: string; months: [string, string, string] };
  payees: EwtPayeeSchedule[];
  /** Per ATC and rate, for the 1601-EQ return; must equal the sum of the payee lines. */
  byAtc: Array<{ atc: string; ratePercent: string; totalIncome: string; taxWithheld: string; payees: number }>;
  totals: { totalIncome: string; taxWithheld: string; payments: number };
  issues: string[];
  /** True only when no issue was found. It is never a filing or a certificate. */
  reviewable: boolean;
  filingReady: false;
};

const cents = (value: unknown) => {
  const number = Number(value);
  const scaled = number * 100;
  const rounded = Math.round(scaled);
  return Number.isFinite(number) && number >= 0 && Math.abs(scaled - rounded) < 1e-6 && Number.isSafeInteger(rounded) ? rounded : null;
};
const money = (value: number) => (value / 100).toFixed(2);

export function ewtQuarterPeriod(quarter: string) {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error("Use a quarter in the form YYYY-Q1 to YYYY-Q4.");
  const year = Number(match[1]);
  const first = (Number(match[2]) - 1) * 3 + 1;
  const month = (offset: number) => `${year}-${String(first + offset).padStart(2, "0")}`;
  const end = new Date(Date.UTC(year, first + 2, 0)).toISOString().slice(0, 10);
  return { start: `${month(0)}-01`, end, months: [month(0), month(1), month(2)] as [string, string, string] };
}

/** Withholding the payments API computes: round2(gross x rate / 100), in centavos, from exact centavo and rate inputs. */
function expectedWithholding(grossCents: number, ratePercent: number) {
  // rate has at most three decimals; scale to an integer so the product is exact before rounding half away from zero.
  const rateMilli = Math.round(ratePercent * 1000);
  return Math.round((grossCents * rateMilli) / 100_000);
}

export function buildEwtQuarterSchedule(input: { quarter: string; payments: readonly EwtPayment[]; payees: readonly EwtPayee[] }): EwtQuarterSchedule {
  const period = ewtQuarterPeriod(input.quarter);
  const issues: string[] = [];
  const payeeById = new Map(input.payees.map((payee) => [payee.id, payee]));
  type Acc = { atc: string; ratePercent: string; months: [number, number, number]; tax: number; ids: number[] };
  const lines = new Map<number, Map<string, Acc>>();
  let totalIncome = 0, totalTax = 0, counted = 0;

  for (const payment of input.payments) {
    const where = "payment #" + payment.id;
    const gross = cents(payment.grossAmountPhp);
    const tax = cents(payment.withholdingAmount);
    const rate = Number(payment.withholdingRate);
    const atc = String(payment.withholdingAtc ?? "").trim().toUpperCase();
    const monthIndex = period.months.indexOf(String(payment.paymentDate).slice(0, 7));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payment.paymentDate)) || monthIndex < 0) { issues.push("OUTSIDE_QUARTER: " + where + " is dated " + payment.paymentDate + ", outside " + input.quarter + "."); continue; }
    if (gross === null || tax === null) { issues.push("INVALID_AMOUNT: " + where + " has an amount that is not an exact non-negative centavo value."); continue; }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 1000 - Math.round(rate * 1000)) > 1e-6) { issues.push("INVALID_RATE: " + where + " has a rate that is not 0-100 with at most three decimals."); continue; }
    if (!atc) { issues.push("MISSING_ATC: " + where + " has no ATC."); continue; }
    const expected = expectedWithholding(gross, rate);
    if (expected !== tax) issues.push("WITHHOLDING_MISMATCH: " + where + " withheld " + money(tax) + " but " + money(gross) + " at " + rate.toFixed(3) + "% is " + money(expected) + ".");
    const payee = payeeById.get(payment.contractorId);
    if (!payee) { issues.push("UNKNOWN_PAYEE: " + where + " names a contractor that is not in this employer's list."); continue; }

    const ratePercent = rate.toFixed(3);
    const key = atc + "|" + ratePercent;
    const byKey = lines.get(payee.id) ?? new Map<string, Acc>();
    const acc = byKey.get(key) ?? { atc, ratePercent, months: [0, 0, 0], tax: 0, ids: [] };
    acc.months[monthIndex] += gross;
    acc.tax += tax;
    acc.ids.push(payment.id);
    byKey.set(key, acc);
    lines.set(payee.id, byKey);
    totalIncome += gross; totalTax += tax; counted += 1;
  }

  const payees: EwtPayeeSchedule[] = [];
  for (const [payeeId, byKey] of [...lines].sort((a, b) => a[0] - b[0])) {
    const payee = payeeById.get(payeeId)!;
    const tin = payee.tin && /^\d{9}$/.test(payee.tin.replace(/\D/g, "")) ? payee.tin.replace(/\D/g, "") : null;
    if (!tin) issues.push("MISSING_TIN: payee #" + payee.id + " has no valid 9-digit TIN; 2307 and the alphalist require one.");
    const country = String(payee.country ?? "").trim().toUpperCase();
    if (country && !["PH", "PHL", "PHILIPPINES"].includes(country)) {
      issues.push("NON_RESIDENT_REVIEW: payee #" + payee.id + " is outside the Philippines; its withholding may be a final tax on another return, not EWT.");
    }
    const payeeLines: EwtPayeeLine[] = [...byKey.values()].sort((a, b) => a.atc.localeCompare(b.atc) || Number(a.ratePercent) - Number(b.ratePercent)).map((acc) => ({
      atc: acc.atc, ratePercent: acc.ratePercent,
      months: [money(acc.months[0]), money(acc.months[1]), money(acc.months[2])],
      totalIncome: money(acc.months[0] + acc.months[1] + acc.months[2]),
      taxWithheld: money(acc.tax), paymentIds: acc.ids,
    }));
    const income = [...byKey.values()].reduce((sum, acc) => sum + acc.months[0] + acc.months[1] + acc.months[2], 0);
    const tax = [...byKey.values()].reduce((sum, acc) => sum + acc.tax, 0);
    payees.push({ contractorId: payee.id, name: payee.name, tin, lines: payeeLines, totalIncome: money(income), totalTaxWithheld: money(tax) });
  }

  const atcTotals = new Map<string, { atc: string; ratePercent: string; income: number; tax: number; payees: Set<number> }>();
  for (const [payeeId, byKey] of lines) for (const [key, acc] of byKey) {
    const row = atcTotals.get(key) ?? { atc: acc.atc, ratePercent: acc.ratePercent, income: 0, tax: 0, payees: new Set<number>() };
    row.income += acc.months[0] + acc.months[1] + acc.months[2];
    row.tax += acc.tax;
    row.payees.add(payeeId);
    atcTotals.set(key, row);
  }
  const byAtc = [...atcTotals.values()].sort((a, b) => a.atc.localeCompare(b.atc) || Number(a.ratePercent) - Number(b.ratePercent))
    .map((row) => ({ atc: row.atc, ratePercent: row.ratePercent, totalIncome: money(row.income), taxWithheld: money(row.tax), payees: row.payees.size }));

  // The per-ATC return and the per-payee schedule are two views of the same payments and must agree to the centavo.
  const atcIncome = byAtc.reduce((sum, row) => sum + (cents(row.totalIncome) ?? 0), 0);
  const atcTax = byAtc.reduce((sum, row) => sum + (cents(row.taxWithheld) ?? 0), 0);
  if (atcIncome !== totalIncome || atcTax !== totalTax) issues.push("SCHEDULE_TOTALS_DIFFER: the per-ATC totals do not equal the payee schedule.");

  return {
    quarter: input.quarter, period, payees, byAtc,
    totals: { totalIncome: money(totalIncome), taxWithheld: money(totalTax), payments: counted },
    issues, reviewable: issues.length === 0, filingReady: false,
  };
}
