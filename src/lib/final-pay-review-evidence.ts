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

export function finalPayReviewShortfall(record: FinalPayReviewRecord) {
  const gross = Number(record.grossFinalPay);
  const tax = Number(record.taxAdjustment);
  const statutory = Number(record.finalStatutoryDeductions);
  const invalid = ![gross, tax, statutory].every(Number.isFinite) || gross < 0 || statutory < 0;
  const total = invalid ? null : Math.max(0, statutory - gross - tax);
  const snapshot = record.computationSnapshot ?? {};
  const sourceTax = snapshot.unpaidTaxWithholding;
  const sourceStatutory = snapshot.unpaidStatutoryDeductions;
  const splitIsValid = !invalid && typeof sourceTax === "number" && typeof sourceStatutory === "number"
    && Number.isFinite(sourceTax) && Number.isFinite(sourceStatutory)
    && sourceTax >= 0 && sourceStatutory >= 0
    && Math.abs(sourceTax + sourceStatutory - (total ?? 0)) < 0.011;
  return {
    total: total === null ? null : Number(money(total)),
    tax: splitIsValid ? Number(money(sourceTax)) : null,
    statutory: splitIsValid ? Number(money(sourceStatutory)) : null,
    reconciliationRequired: total === null || total > 0.004,
    splitRecorded: splitIsValid,
  };
}

export function finalPayLoanReviewSummary(record: FinalPayReviewRecord) {
  const raw = record.computationSnapshot?.loanAuthority;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { recorded: false, eligibleBalance: null, unrecoveredBalance: null, unrecovered: [] as Array<{ id: number; loanType: string; balance: number | null; reason: string }> };
  }
  const data = raw as Record<string, unknown>;
  const unrecovered = Array.isArray(data.unrecoveredLoans) ? data.unrecoveredLoans.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const loan = item as Record<string, unknown>;
    if (!Number.isSafeInteger(loan.id) || Number(loan.id) <= 0
      || typeof loan.loanType !== "string" || loan.loanType.length > 64
      || (loan.balance !== null && (typeof loan.balance !== "number" || !Number.isFinite(loan.balance) || loan.balance < 0))
      || typeof loan.reason !== "string") return [];
    return [{
      id: Number(loan.id),
      loanType: loan.loanType,
      balance: loan.balance === null ? null : Number(loan.balance),
      reason: loan.reason,
    }];
  }) : [];
  const eligible = data.eligibleBalance;
  const withheld = data.unrecoveredBalance;
  if (typeof eligible !== "number" || !Number.isFinite(eligible) || eligible < 0
    || typeof withheld !== "number" || !Number.isFinite(withheld) || withheld < 0) {
    return { recorded: false, eligibleBalance: null, unrecoveredBalance: null, unrecovered: [] as typeof unrecovered };
  }
  return {
    recorded: true,
    eligibleBalance: eligible,
    unrecoveredBalance: withheld,
    unrecovered,
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
  const loanReview = finalPayLoanReviewSummary(record);
  const rows: Array<[string, string]> = [
    ["Employee number", record.employeeNo],
    ["Employee", record.employeeName],
    ["Separation record ID", String(record.id)],
    ["Gross final pay (PHP)", money(Number(record.grossFinalPay))],
    ["Tax adjustment (PHP; negative = collection)", money(Number(record.taxAdjustment))],
    ["Requested final statutory deductions (PHP)", money(Number(record.finalStatutoryDeductions))],
    ["Loan deductions applied (PHP)", money(Number(record.loanDeductions))],
    ["Eligible loans proposed for deduction (PHP)", loanReview.recorded ? money(loanReview.eligibleBalance!) : "NO EVIDENCE - RECOMPUTE"],
    ["Outstanding loans excluded pending authority review (PHP)", loanReview.recorded ? money(loanReview.unrecoveredBalance!) : "NO EVIDENCE - RECOMPUTE"],
    ["Loan authorization disclaimer", "References are operator records, not independent proof of employee signature or legal authority."],
    ["Net final pay (PHP)", money(Number(record.netFinalPay))],
    ["Unpaid mandatory deductions (PHP)", shortfall.total === null ? "UNVERIFIABLE" : money(shortfall.total)],
    ["Unpaid tax withholding (PHP)", shortfall.tax === null ? "NOT RECORDED - RECOMPUTE" : money(shortfall.tax)],
    ["Unpaid statutory deductions (PHP)", shortfall.statutory === null ? "NOT RECORDED - RECOMPUTE" : money(shortfall.statutory)],
    ["Allocation policy (provisional)", typeof snapshot.shortfallAllocationPolicy === "string" ? snapshot.shortfallAllocationPolicy : "NOT RECORDED"],
    ["Approval/release status", shortfall.reconciliationRequired ? "BLOCKED - FINANCE/PAYROLL RECONCILIATION REQUIRED" : "NO MANDATORY SHORTFALL; OTHER RELEASE GATES STILL APPLY"],
    ["Statement", "Review worksheet only. Not evidence of statutory remittance, tax payment, or bank settlement."],
  ];
  for (const loan of loanReview.unrecovered) {
    rows.push([
      "Unrecovered loan #" + loan.id + " (" + loan.loanType + ")",
      (loan.balance === null ? "BALANCE INVALID" : money(loan.balance)) + " - " + loan.reason,
    ]);
  }
  return [["Field", "Value"], ...rows].map(cols => cols.map(csvValue).join(",")).join("\r\n") + "\r\n";
}
