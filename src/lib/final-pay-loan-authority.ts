import { createHash } from "node:crypto";

/**
 * Eligibility to include an active loan in the *proposed* final-pay deduction.
 * Recorded references and independent review are required; the software cannot
 * certify that a document is legally signed or that a particular deduction is
 * lawful. Those are separate payroll/legal release reviews.
 */
export type FinalPayLoanEvidence = {
  id: number;
  loanType: string;
  status: string;
  remainingBalance: string | number;
  requestedByUserId?: number | null;
  reviewedByUserId?: number | null;
  reviewedAt?: Date | string | null;
  deductionAuthorizationReference?: string | null;
  reviewEvidenceReference?: string | null;
};

export type LoanReviewReason =
  | "MISSING_INDEPENDENT_SIGNED_AUTHORITY_EVIDENCE"
  | "INVALID_OUTSTANDING_BALANCE";

export type FinalPayLoanReview = {
  eligibleLoanIds: number[];
  eligibleBalance: number;
  unrecoveredLoans: Array<{ id: number; loanType: string; balance: number | null; reason: LoanReviewReason }>;
  unrecoveredBalance: number;
  invalidLoanIds: number[];
  evidenceDigest: string;
};

function parseCents(value: string | number): number | null {
  const raw = String(value);
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, decimal = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function referenceRecorded(value: string | null | undefined): boolean {
  const ref = typeof value === "string" ? value.trim() : "";
  return ref.length >= 8 && ref.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(ref)
    && !/^(?:n\/?a|none|unknown|pending|test(?:ing)?|not applicable)(?:\b|$)/i.test(ref);
}

function reviewedAtIso(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function independentlyReviewed(loan: FinalPayLoanEvidence): boolean {
  return Number.isSafeInteger(loan.requestedByUserId) && Number(loan.requestedByUserId) > 0
    && Number.isSafeInteger(loan.reviewedByUserId) && Number(loan.reviewedByUserId) > 0
    && loan.requestedByUserId !== loan.reviewedByUserId
    && Boolean(reviewedAtIso(loan.reviewedAt))
    && referenceRecorded(loan.deductionAuthorizationReference)
    && referenceRecorded(loan.reviewEvidenceReference);
}

/** Deterministic, evidence-minimized loan review. No raw document references leave this helper. */
export function reviewFinalPayLoans(loans: readonly FinalPayLoanEvidence[]): FinalPayLoanReview {
  const active = loans.filter(loan => loan.status === "active").sort((a, b) => a.id - b.id);
  const digest = createHash("sha256").update(JSON.stringify(active.map(loan => ({
    id: loan.id,
    loanType: loan.loanType,
    status: loan.status,
    balance: String(loan.remainingBalance),
    requester: loan.requestedByUserId ?? null,
    reviewer: loan.reviewedByUserId ?? null,
    reviewedAt: reviewedAtIso(loan.reviewedAt),
    signedAuthorityReference: loan.deductionAuthorizationReference ?? null,
    approvalEvidenceReference: loan.reviewEvidenceReference ?? null,
  })))).digest("hex");

  const eligibleLoanIds: number[] = [];
  const unrecoveredLoans: FinalPayLoanReview["unrecoveredLoans"] = [];
  const invalidLoanIds: number[] = [];
  let eligibleCents = 0;
  let unrecoveredCents = 0;

  for (const loan of active) {
    const balanceCents = parseCents(loan.remainingBalance);
    if (!Number.isSafeInteger(loan.id) || loan.id <= 0 || balanceCents === null) {
      invalidLoanIds.push(loan.id);
      unrecoveredLoans.push({
        id: loan.id, loanType: loan.loanType, balance: null,
        reason: "INVALID_OUTSTANDING_BALANCE",
      });
      continue;
    }
    if (balanceCents === 0) continue;
    if (independentlyReviewed(loan)) {
      eligibleLoanIds.push(loan.id);
      eligibleCents += balanceCents;
    } else {
      unrecoveredCents += balanceCents;
      unrecoveredLoans.push({
        id: loan.id, loanType: loan.loanType,
        balance: balanceCents / 100,
        reason: "MISSING_INDEPENDENT_SIGNED_AUTHORITY_EVIDENCE",
      });
    }
    if (!Number.isSafeInteger(eligibleCents) || !Number.isSafeInteger(unrecoveredCents)) {
      invalidLoanIds.push(loan.id);
      break;
    }
  }

  return {
    eligibleLoanIds,
    eligibleBalance: eligibleCents / 100,
    unrecoveredLoans,
    unrecoveredBalance: unrecoveredCents / 100,
    invalidLoanIds,
    evidenceDigest: digest,
  };
}

/** Reconciliation gate used inside locked approval and release transactions. */
export function matchesRecordedFinalPayLoanReview(
  stored: unknown,
  current: FinalPayLoanReview,
): boolean {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const evidence = stored as Partial<FinalPayLoanReview>;
  return evidence.evidenceDigest === current.evidenceDigest
    && JSON.stringify(evidence.eligibleLoanIds) === JSON.stringify(current.eligibleLoanIds)
    && evidence.eligibleBalance === current.eligibleBalance
    && JSON.stringify(evidence.unrecoveredLoans) === JSON.stringify(current.unrecoveredLoans)
    && evidence.unrecoveredBalance === current.unrecoveredBalance
    && Array.isArray(evidence.invalidLoanIds) && evidence.invalidLoanIds.length === 0
    && current.invalidLoanIds.length === 0;
}
