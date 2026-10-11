import { storedMoneyCentavos } from "@/lib/stored-money-centavos";

/** Reconciliation-only display/export of immutable separation financial evidence. */
export type FinalPayReviewRecord = {
  id: number;
  employeeNo: string;
  employeeName: string;
  grossFinalPay: string | number;
  netFinalPay: string | number;
  taxAdjustment: string | number;
  finalStatutoryDeductions: string | number;
  loanDeductions: string | number;
  computationSnapshot?: Record<string, unknown> | null;
};

const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
const verifiedCsvMoney = (value: unknown) => {
  const cents = storedMoneyCentavos(value);
  return cents === null ? "UNVERIFIABLE" : (cents / 100).toFixed(2);
};

export function finalPayReviewShortfall(record: FinalPayReviewRecord) {
  const gross = storedMoneyCentavos(record.grossFinalPay);
  const tax = storedMoneyCentavos(record.taxAdjustment);
  const statutory = storedMoneyCentavos(record.finalStatutoryDeductions);
  const candidate = gross !== null && tax !== null && statutory !== null
    && gross >= 0 && statutory >= 0 ? statutory - gross - tax : null;
  const totalCents = candidate !== null && Number.isSafeInteger(candidate)
    ? Math.max(0, candidate) : null;
  const snapshot = record.computationSnapshot ?? {};
  const sourceTax = storedMoneyCentavos(snapshot.unpaidTaxWithholding);
  const sourceStatutory = storedMoneyCentavos(snapshot.unpaidStatutoryDeductions);
  const splitIsValid = totalCents !== null && sourceTax !== null && sourceStatutory !== null
    && sourceTax >= 0 && sourceStatutory >= 0
    && Number.isSafeInteger(sourceTax + sourceStatutory)
    && sourceTax + sourceStatutory === totalCents;
  return {
    total: totalCents === null ? null : totalCents / 100,
    tax: splitIsValid ? sourceTax! / 100 : null,
    statutory: splitIsValid ? sourceStatutory! / 100 : null,
    reconciliationRequired: totalCents === null || totalCents > 0,
    splitRecorded: splitIsValid,
  };
}

// CSV values can include employer-controlled names/IDs. Escape formula leaders,
// including Unicode whitespace followed by spreadsheet formula prefixes.
function csvValue(value: string) {
  const safe = /^\s*[=+@-]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function finalPayReviewCsv(record: FinalPayReviewRecord) {
  const shortfall = finalPayReviewShortfall(record);
  const snapshot = record.computationSnapshot ?? {};
  const rows: Array<[string, string]> = [
    ["Employee number", record.employeeNo],
    ["Employee", record.employeeName],
    ["Separation record ID", String(record.id)],
    ["Gross final pay (PHP)", verifiedCsvMoney(record.grossFinalPay)],
    ["Tax adjustment (PHP; negative = collection)", verifiedCsvMoney(record.taxAdjustment)],
    ["Requested final statutory deductions (PHP)", verifiedCsvMoney(record.finalStatutoryDeductions)],
    ["Loan deductions applied (PHP)", verifiedCsvMoney(record.loanDeductions)],
    ["Net final pay (PHP)", verifiedCsvMoney(record.netFinalPay)],
    ["Unpaid mandatory deductions (PHP)", shortfall.total === null ? "UNVERIFIABLE" : money(shortfall.total)],
    ["Unpaid tax withholding (PHP)", shortfall.tax === null ? "NOT RECORDED - RECOMPUTE" : money(shortfall.tax)],
    ["Unpaid statutory deductions (PHP)", shortfall.statutory === null ? "NOT RECORDED - RECOMPUTE" : money(shortfall.statutory)],
    ["Allocation policy (provisional)", typeof snapshot.shortfallAllocationPolicy === "string" ? snapshot.shortfallAllocationPolicy : "NOT RECORDED"],
    ["Approval/release status", shortfall.reconciliationRequired ? "BLOCKED - FINANCE/PAYROLL RECONCILIATION REQUIRED" : "NO MANDATORY SHORTFALL; OTHER RELEASE GATES STILL APPLY"],
    ["Statement", "Review worksheet only. Not evidence of statutory remittance, tax payment, or bank settlement."],
  ];
  return [["Field", "Value"], ...rows].map(cols => cols.map(csvValue).join(",")).join("\r\n") + "\r\n";
}
