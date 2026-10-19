import { toCsv } from "@/lib/csv";

export type ReleasedJournalRun = {
  id: number;
  organizationId: number;
  legalEntityId: number | null;
  status: string;
  payDate: string;
  periodLabel: string;
  grossPay: string | number;
  netPay: string | number;
};

export type JournalLine = {
  runId: number;
  legalEntityId: number;
  payDate: string;
  period: string;
  accountCode: string;
  accountName: string;
  debitCentavos: number;
  creditCentavos: number;
};

/** Decimal string -> integer centavos without floating point payroll recomputation. */
export function journalMoneyCentavos(input: string | number): number {
  const value = String(input);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Stored payroll journal money has invalid precision or sign.");
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Payroll journal centavos exceed the safe integer range.");
  }
  return Number(amount);
}

/** Released payroll only. Missing legal-employer attribution blocks export. */
export function buildReleasedPayrollJournal(runs: readonly ReleasedJournalRun[]): JournalLine[] {
  if (runs.length > 2_000) throw new Error("Reduce the journal export to at most 2,000 payroll runs.");
  const lines: JournalLine[] = [];
  for (const run of runs) {
    if (run.status !== "Released") throw new Error("Only released payroll can enter an accounting journal.");
    if (!Number.isSafeInteger(run.id) || run.id < 1
      || !Number.isSafeInteger(run.organizationId) || run.organizationId < 1
      || !Number.isSafeInteger(run.legalEntityId) || Number(run.legalEntityId) < 1) {
      throw new Error("Payroll journal requires immutable legal-employer attribution.");
    }
    const gross = journalMoneyCentavos(run.grossPay);
    const net = journalMoneyCentavos(run.netPay);
    // A reviewed year-end tax refund can make net payroll exceed wage gross.
    // Keep the signed withholding control rather than rejecting an otherwise
    // reconcilable released run or inventing negative accounting credits.
    const deductions = gross - net;
    const base = {
      runId: run.id, legalEntityId: run.legalEntityId as number,
      payDate: run.payDate, period: run.periodLabel,
    };
    lines.push({
      ...base, accountCode: "6000", accountName: "Payroll expense",
      debitCentavos: gross, creditCentavos: 0,
    });
    if (deductions !== 0) lines.push({
      ...base, accountCode: "2100", accountName: "Payroll deductions control",
      debitCentavos: Math.max(0, -deductions), creditCentavos: Math.max(0, deductions),
    });
    lines.push({
      ...base, accountCode: "2200", accountName: "Net payroll payable",
      debitCentavos: 0, creditCentavos: net,
    });
  }
  const debit = lines.reduce((amount, row) => amount + BigInt(row.debitCentavos), BigInt(0));
  const credit = lines.reduce((amount, row) => amount + BigInt(row.creditCentavos), BigInt(0));
  if (debit !== credit) throw new Error("Unbalanced payroll accounting journal.");
  return lines;
}

export function payrollJournalToCsv(lines: readonly JournalLine[]): string {
  const amount = (centavos: number) =>
    `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
  return toCsv({
    columns: ["Payroll run ID", "Legal entity ID", "Pay date", "Period",
      "Account code", "Account name", "Debit PHP", "Credit PHP"],
    rows: lines.map(row => [
      String(row.runId), String(row.legalEntityId), row.payDate, row.period,
      row.accountCode, row.accountName,
      amount(row.debitCentavos), amount(row.creditCentavos),
    ]),
  });
}
