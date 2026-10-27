import { storedMoneyCentavos } from "./stored-money-centavos";

const phpCurrency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Read-only presentation of persisted payroll net pay. Do not turn missing,
 * malformed, or unsafe values into a plausible PHP 0.00. This does not
 * recalculate payroll, verify run-to-entry reconciliation, or authorize payout.
 */
export function formatRecentPayrollNetPay(value: unknown): string | null {
  const centavos = storedMoneyCentavos(value);
  return centavos === null ? null : phpCurrency.format(centavos / 100);
}
