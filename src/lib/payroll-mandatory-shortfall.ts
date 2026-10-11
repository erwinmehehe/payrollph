/**
 * Centavo-exact provisional collection when mandatory deductions exceed pay.
 * This does NOT authorize partial statutory remittance or release: payroll
 * assurance always blocks any uncollected amount for human reconciliation.
 */
export type MandatoryDeductionComponents = {
  sss: number;
  philHealth: number;
  pagIbig: number;
  withholding: number;
  yearEndTaxAdjustment: number; // negative means a tax refund
  tardiness: number;
  undertime: number;
};

const priority: ReadonlyArray<keyof MandatoryDeductionComponents> = [
  "yearEndTaxAdjustment", "withholding", "sss", "philHealth", "pagIbig", "tardiness", "undertime",
];

function integerCents(amount: number, label: string) {
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents)) {
    throw new Error(`${label} must have a finite, safely representable centavo value.`);
  }
  return cents;
}

function checkedSum(amounts: readonly number[], label: string) {
  let value = 0;
  for (const cents of amounts) {
    value += cents;
    if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds the safe centavo range.`);
  }
  return value;
}

export function allocateMandatoryDeductions(gross: number, due: MandatoryDeductionComponents) {
  const grossCents = integerCents(gross, "Gross pay");
  if (grossCents < 0) throw new Error("Gross pay cannot be negative.");
  const requestedCents: MandatoryDeductionComponents = {
    sss: integerCents(due.sss, "SSS"),
    philHealth: integerCents(due.philHealth, "PhilHealth"),
    pagIbig: integerCents(due.pagIbig, "Pag-IBIG"),
    withholding: integerCents(due.withholding, "Withholding"),
    yearEndTaxAdjustment: integerCents(due.yearEndTaxAdjustment, "Year-end tax adjustment"),
    tardiness: integerCents(due.tardiness, "Tardiness"),
    undertime: integerCents(due.undertime, "Undertime"),
  };
  for (const key of priority) {
    if (key !== "yearEndTaxAdjustment" && requestedCents[key] < 0) {
      throw new Error(`${key} requested deduction cannot be negative.`);
    }
  }

  // Refunds are additional available cash, not deductions to be capped.
  const refundCents = Math.max(0, -requestedCents.yearEndTaxAdjustment);
  let availableCents = checkedSum([grossCents, refundCents], "Gross pay plus tax refund");
  const appliedCents = { ...requestedCents };
  const uncollectedCents = { ...requestedCents };

  // Deterministic *provisional* allocation for readable accounting only.
  // Any shortfall blocks payroll; employer/statutory priority needs sign-off.
  for (const key of priority) {
    const owed = Math.max(0, requestedCents[key]);
    const applied = Math.min(owed, availableCents);
    availableCents -= applied;
    appliedCents[key] = applied;
    uncollectedCents[key] = owed - applied;
  }
  if (requestedCents.yearEndTaxAdjustment < 0) {
    appliedCents.yearEndTaxAdjustment = requestedCents.yearEndTaxAdjustment;
    uncollectedCents.yearEndTaxAdjustment = 0;
  }

  const requiredCents = checkedSum(priority.map((key) => requestedCents[key]), "Mandatory requested total");
  const appliedTotalCents = checkedSum(priority.map((key) => appliedCents[key]), "Mandatory applied total");
  const uncollectedTotalCents = checkedSum(priority.map((key) => uncollectedCents[key]), "Mandatory uncollected total");
  if (requiredCents - appliedTotalCents !== uncollectedTotalCents || grossCents - appliedTotalCents !== availableCents) {
    throw new Error("Mandatory payroll deductions did not reconcile exactly to centavos.");
  }
  const applied = { ...appliedCents };
  const uncollected = { ...uncollectedCents };
  for (const key of priority) {
    applied[key] /= 100;
    uncollected[key] /= 100;
  }
  return {
    applied,
    uncollected,
    requestedTotal: requiredCents / 100,
    appliedTotal: appliedTotalCents / 100,
    totalUncollected: uncollectedTotalCents / 100,
    disposableBeforeOptional: availableCents / 100,
  };
}
