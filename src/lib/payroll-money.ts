/**
 * Financial rounding rule: store the same centavos that a payslip displays.
 * Round each payroll earnings bucket before summing, using integer centavos.
 * This avoids raw float fractions making gross disagree with printed buckets.
 */
export function roundedGrossFromBuckets(buckets: readonly number[]): number {
  let totalCentavos = 0;
  for (const amount of buckets) {
    if (!Number.isFinite(amount)) throw new Error("Non-finite payroll amount cannot be included in gross.");
    const cents = Math.round((amount + Number.EPSILON) * 100);
    // Number arithmetic cannot represent centavos exactly outside its safe
    // integer range. Fail closed rather than writing a plausible but incorrect
    // gross that diverges from the ledger or payslip.
    if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(totalCentavos + cents)) {
      throw new Error("Payroll gross exceeds the safe centavo range.");
    }
    totalCentavos += cents;
  }
  return Math.max(0, totalCentavos) / 100;
}

/** Keep the displayed split rather than subtracting a raw holiday fraction. */
export function roundedBasicPayBuckets(workedPay: number, unworkedHolidayPay: number) {
  const round = (amount: number) => {
    const cents = Math.round((amount + Number.EPSILON) * 100);
    if (!Number.isFinite(amount) || !Number.isSafeInteger(cents)) throw new Error("Basic pay exceeds the safe centavo range.");
    return cents / 100;
  };
  const worked = round(workedPay), unworkedHoliday = round(unworkedHolidayPay);
  return { worked, unworkedHoliday, total: roundedGrossFromBuckets([worked, unworkedHoliday]) };
}

/**
 * Divide an unchanged, fixed monthly salary into standard semi-monthly cutoffs
 * in integer centavos. First cutoff gets the odd centavo; the final cutoff
 * receives the exact remainder. This is a *payroll allocation convention*,
 * not an SSS-mandated contribution split. Caller must verify a full unchanged
 * monthly contract, actual standard cutoffs, and the released first-cutoff
 * ledger before applying the final-cutoff amount.
 */
export function splitFixedMonthlyBasic(monthlySalary: number): {
  first: number; second: number; monthly: number;
} {
  const cents = Math.round((monthlySalary + Number.EPSILON) * 100);
  if (
    !Number.isFinite(monthlySalary) || monthlySalary < 0
    || !Number.isSafeInteger(cents)
    || Math.abs(monthlySalary * 100 - cents) > 0.000001
  ) {
    throw new Error("Fixed monthly salary must be an exact, safe nonnegative centavo amount.");
  }
  const firstCents = Math.ceil(cents / 2);
  return {
    first: firstCents / 100,
    second: (cents - firstCents) / 100,
    monthly: cents / 100,
  };
}

/** The prior-cutoff ledger may contain all zeroes and must still be used. */
export function statutoryTrueUpDecision(input: {
  isFinalCutoffOfMonth: boolean;
  priorCutoffPresent: boolean;
  newHireInCurrentCutoff: boolean;
}): { canTrueUp: boolean; missingPriorInput: boolean } {
  const missingPriorInput =
    input.isFinalCutoffOfMonth && !input.priorCutoffPresent && !input.newHireInCurrentCutoff;
  return {
    canTrueUp: input.isFinalCutoffOfMonth && (input.priorCutoffPresent || input.newHireInCurrentCutoff),
    missingPriorInput,
  };
}
