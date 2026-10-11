/**
 * Pure database-catalog shape check for four required bank destination stores.
 * No bank values, account numbers, credentials or data rows are involved.
 */
export type BankColumn = {
  name: string;
  typeName: string;
  maxLength: number | null;
};
export const bankBackfillColumns = [
  "employees.bank_account",
  "payroll_entries.trace",
  "legal_entities.disbursement_account",
  "employee_payout_change_requests.proposed_bank_account",
] as const;

export function bankBackfillSchemaGaps(rows: readonly BankColumn[]): string[] {
  return bankBackfillColumns.filter((name) => {
    const row = rows.find((item) => item.name === name);
    if (!row) return true;
    if (name === "payroll_entries.trace") return row.typeName !== "jsonb";
    if (row.typeName === "text") return false;
    return row.typeName !== "varchar" ||
      (row.maxLength !== null && (!Number.isSafeInteger(row.maxLength) || row.maxLength < 160));
  });
}
