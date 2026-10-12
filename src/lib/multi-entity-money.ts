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
    const cents = BigInt(whole) * 10BigInt(0) +
      BigInt((fraction.slice(0, 2) + "00").slice(0, 2));
    centavos += sign === "-" ? -cents : cents;
  }
  const negative = centavos < BigInt(0);
  const absolute = negative ? -centavos : centavos;
  return `${negative ? "-" : ""}${absolute / 10BigInt(0)}.${(absolute % 10BigInt(0)).toString().padStart(2, "0")}`;
}
