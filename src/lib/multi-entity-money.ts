/**
 * Convert PostgreSQL numeric text to exact centavos before totaling.
 * Do not use IEEE-754 Number arithmetic for payroll amounts.
 */
export function sumPayrollAmounts(values: readonly string[]): string {
  let centavos = BigInt(0);
  for (const raw of values) {
    const normalized = raw.trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
    if (!match) throw new Error("Payroll amount is not a valid decimal.");
    const [, sign, whole, fraction = ""] = match;
    if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
      throw new Error("Payroll total contains unexplained sub-centavo precision.");
    }
    const cents = BigInt(whole) * BigInt(100) +
      BigInt((fraction.slice(0, 2) + "00").slice(0, 2));
    centavos += sign === "-" ? -cents : cents;
  }
  const negative = centavos < BigInt(0);
  const absolute = negative ? -centavos : centavos;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}

/**
 * Every material group-report aggregate must belong to an actual legal employer
 * in the requested tenant. A non-null foreign/orphan employer ID is just as
 * unsafe as NULL: omitting it would understate wages or employee headcount.
 * This is a read-only reconciliation gate, never a historical-data backfill.
 */
export function groupReportHasUnattributedRows(
  legalEntityIds: readonly number[],
  headcounts: readonly { legalEntityId: number | null; total: number }[],
  payrollCosts: readonly { legalEntityId: number | null; runs: number }[],
): boolean {
  const assigned = new Set(legalEntityIds);
  const recognized = (id: number | null) =>
    id !== null && Number.isSafeInteger(id) && assigned.has(id);
  return headcounts.some(row => row.total > 0 && !recognized(row.legalEntityId)) ||
    payrollCosts.some(row => row.runs > 0 && !recognized(row.legalEntityId));
}
