/**
 * The legacy eight-worker development-demo seed is illustrative only.
 * These are integer-peso test inputs, NOT statutory rates, employer pay,
 * signed approvals, payments or filing evidence. Never use in production.
 *
 * A run's header and its rows must share this source, so future sample-data
 * edits cannot silently create non-reconciling payroll totals.
 */
const FICTIONAL_RUNS = {
  processing: {
    gross: [38500, 29200, 36500, 32500, 24500, 21800, 41000, 34800],
    deductions: [7284, 5540, 6942, 6175, 4655, 4142, 7790, 6608],
  },
  released: {
    gross: [37400, 28400, 35200, 31600, 23800, 21000, 39800, 33600],
    deductions: [7100, 5380, 6680, 6000, 4520, 3990, 7560, 6380],
  },
} as const;

export const DEV_DEMO_PAYROLL_WORKERS = 8;
export type DevDemoPayrollPeriod = keyof typeof FICTIONAL_RUNS;

export function fictionalDevSeedPayroll(period: DevDemoPayrollPeriod) {
  const amounts = FICTIONAL_RUNS[period];
  if (!amounts || amounts.gross.length !== DEV_DEMO_PAYROLL_WORKERS ||
      amounts.deductions.length !== DEV_DEMO_PAYROLL_WORKERS) {
    throw new Error("Only complete eight-worker fictional development payroll runs may be seeded.");
  }
  const entries = amounts.gross.map((gross, index) => {
    const deductions = amounts.deductions[index];
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(deductions) ||
        gross < 0 || deductions < 0 || deductions > gross) {
      throw new Error("Fictional development payroll amounts must be valid integer pesos.");
    }
    return { gross, deductions, net: gross - deductions };
  });
  return {
    entries,
    grossPay: entries.reduce((total, row) => total + row.gross, 0).toFixed(2),
    netPay: entries.reduce((total, row) => total + row.net, 0).toFixed(2),
  };
}
