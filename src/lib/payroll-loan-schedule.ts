import { parseLoanCents, moneyFromCents, validLoanDate, loanApprovalReference } from "@/lib/payroll-loan-approval";

/**
 * A-1 calculation-only preview. This module never activates a deduction,
 * changes an employee loan or certifies employee consent/DOLE authority.
 * The authoritative ledger and final-pay loan review remain unchanged.
 */
export type LoanInstallment = {
  installment: number;
  principalCents: number;
  interestCents: number;
  dueCents: number;
  remainingPrincipalCents: number;
  remainingPayableCents: number;
};

export function buildCompanyLoanSchedule(input: {
  principal: string;
  months: number;
  installmentsPerMonth: 1 | 2;
  annualFlatInterestBasisPoints: number;
}): { totalPrincipalCents: number; totalInterestCents: number; totalPayableCents: number; installments: LoanInstallment[] } {
  const principalCents = typeof input.principal === "string" ? parseLoanCents(input.principal) : null;
  if (principalCents === null || !Number.isSafeInteger(input.months) || input.months < 1 || input.months > 120 ||
      (input.installmentsPerMonth !== 1 && input.installmentsPerMonth !== 2) ||
      !Number.isSafeInteger(input.annualFlatInterestBasisPoints) ||
      input.annualFlatInterestBasisPoints < 0 || input.annualFlatInterestBasisPoints > 10_000) {
    throw new Error("INVALID_LOAN_SCHEDULE");
  }
  // Flat simple interest is explicit. Never imply compound interest or use
  // binary floats for stored centavos; this must match the signed loan terms.
  const n = input.months * input.installmentsPerMonth;
  const interestBig = (BigInt(principalCents) * BigInt(input.annualFlatInterestBasisPoints) *
    BigInt(input.months) + BigInt(60_000)) / BigInt(120_000);
  if (interestBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("LOAN_OVERFLOW");
  const interestCents = Number(interestBig);
  const totalPayableCents = principalCents + interestCents;
  if (!Number.isSafeInteger(totalPayableCents)) throw new Error("LOAN_OVERFLOW");

  const principalPerCutoff = Math.floor(principalCents / n);
  const interestPerCutoff = Math.floor(interestCents / n);
  let principalRemaining = principalCents;
  let interestRemaining = interestCents;
  const installments: LoanInstallment[] = [];
  for (let index = 1; index <= n; index++) {
    const last = index === n;
    const principal = last ? principalRemaining : principalPerCutoff;
    const interest = last ? interestRemaining : interestPerCutoff;
    principalRemaining -= principal;
    interestRemaining -= interest;
    installments.push({
      installment: index,
      principalCents: principal,
      interestCents: interest,
      dueCents: principal + interest,
      remainingPrincipalCents: principalRemaining,
      remainingPayableCents: principalRemaining + interestRemaining,
    });
  }
  return { totalPrincipalCents: principalCents, totalInterestCents: interestCents,
    totalPayableCents, installments };
}

export type AgencyLoanAmortizationRow = {
  dueDate: string;
  amount: string;
  sourceRowId: string;
};

export function validateAgencyAmortizationSchedule(
  rows: readonly AgencyLoanAmortizationRow[],
  agency: "SSS" | "Pag-IBIG",
  loanReference: string,
): { agency: "SSS" | "Pag-IBIG"; loanReference: string; rows: Array<AgencyLoanAmortizationRow & { cents: number }>; scheduledTotalCents: number } {
  if ((agency !== "SSS" && agency !== "Pag-IBIG") ||
      typeof loanReference !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9 _./-]{3,63}$/.test(loanReference) ||
      !Array.isArray(rows) || rows.length < 1 || rows.length > 240) {
    throw new Error("INVALID_AGENCY_LOAN_SCHEDULE");
  }
  const seenDates = new Set<string>();
  const seenRows = new Set<string>();
  let total = 0;
  const parsed = rows.map(row => {
    // A JSON preview must not turn numeric or object-shaped references into
    // seemingly genuine agency-issued evidence through string coercion.
    if (!row || typeof row !== "object" ||
        typeof row.dueDate !== "string" || typeof row.amount !== "string" ||
        typeof row.sourceRowId !== "string") {
      throw new Error("INVALID_AGENCY_LOAN_INSTALLMENT");
    }
    const cents = parseLoanCents(row.amount, 9_999_999_999);
    if (!validLoanDate(row.dueDate) || cents === null || !/^[A-Za-z0-9_-]{4,100}$/.test(row.sourceRowId) ||
        seenDates.has(row.dueDate) || seenRows.has(row.sourceRowId)) {
      throw new Error("INVALID_AGENCY_LOAN_INSTALLMENT");
    }
    seenDates.add(row.dueDate);
    seenRows.add(row.sourceRowId);
    total += cents;
    if (!Number.isSafeInteger(total)) throw new Error("AGENCY_LOAN_SCHEDULE_OVERFLOW");
    return { dueDate: row.dueDate, amount: moneyFromCents(cents), sourceRowId: row.sourceRowId, cents };
  });
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].dueDate <= parsed[i - 1].dueDate) throw new Error("AGENCY_LOAN_DATES_UNSORTED");
  }
  return { agency, loanReference, rows: parsed, scheduledTotalCents: total };
}

/**
 * Forecast only. An override is not a legal entitlement and MUST have its own
 * immutable, independent approval and audit evidence before a payroll write.
 */
export function previewDiscretionaryLoanDeduction(input: {
  disposablePayCents: number;
  minimumNetPayCents: number;
  remainingLoanCents: number;
  requestedCents: number;
  override?: {
    requesterUserId: number;
    approverUserId: number;
    legalAuthorityReviewed: boolean;
    approvalEvidenceReference: string;
    reason: string;
  };
}): { deductedCents: number; deferredCents: number; netAfterCents: number; overrideUsed: boolean } {
  const fields = [input.disposablePayCents, input.minimumNetPayCents, input.remainingLoanCents, input.requestedCents];
  if (fields.some(n => !Number.isSafeInteger(n) || n < 0) ||
      input.remainingLoanCents < input.requestedCents && input.remainingLoanCents < 1) {
    throw new Error("INVALID_LOAN_FLOOR_INPUT");
  }
  const override = input.override;
  const mayOverride = !!override &&
    Number.isSafeInteger(override.requesterUserId) && override.requesterUserId > 0 &&
    Number.isSafeInteger(override.approverUserId) && override.approverUserId > 0 &&
    override.requesterUserId !== override.approverUserId && override.legalAuthorityReviewed === true &&
    loanApprovalReference(override.approvalEvidenceReference) !== null &&
    typeof override.reason === "string" &&
    override.reason.trim().length >= 20 && override.reason.trim().length <= 500 &&
    !/[\u0000-\u001f\u007f]/.test(override.reason);
  if (override && !mayOverride) throw new Error("LOAN_FLOOR_OVERRIDE_NOT_APPROVED");
  const cap = Math.max(0, input.disposablePayCents - (mayOverride ? 0 : input.minimumNetPayCents));
  const deductedCents = Math.min(input.requestedCents, input.remainingLoanCents, cap);
  return {
    deductedCents,
    deferredCents: input.requestedCents - deductedCents,
    netAfterCents: input.disposablePayCents - deductedCents,
    overrideUsed: mayOverride && deductedCents > Math.max(0, input.disposablePayCents - input.minimumNetPayCents),
  };
}
