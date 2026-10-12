/**
 * Convert PostgreSQL numeric text to exact centavos before totaling.
 * Do not use IEEE-754 Number arithmetic for payroll amounts.
 */
export function sumPayrollAmounts(values: readonly string[]): string {
  let centavos = 0n;
  for (const raw of values) {
    const normalized = raw.trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
    if (!match) throw new Error("Payroll amount is not a valid decimal.");
    const [, sign, whole, fraction = ""] = match;
    if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
      throw new Error("Payroll total contains unexplained sub-centavo precision.");
    }
    const cents = BigInt(whole) * 100n +
      BigInt((fraction.slice(0, 2) + "00").slice(0, 2));
    centavos += sign === "-" ? -cents : cents;
  }
  const negative = centavos < 0n;
  const absolute = negative ? -centavos : centavos;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
