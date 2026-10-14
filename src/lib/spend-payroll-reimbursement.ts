import { storedMoneyCentavos } from "@/lib/stored-money-centavos";

export function approvedReimbursementAmount(value: unknown, submitted: unknown): string | null {
  const cents = storedMoneyCentavos(value), cap = storedMoneyCentavos(submitted);
  return cents !== null && cap !== null && cents > 0 && cents <= cap && cap <= 999999999999 ? (cents / 100).toFixed(2) : null;
}
export type ReimbursementClaimSnapshot = {
  status: string; payrollRunId: number | null; amount: unknown; approvedAmount?: unknown;
  categoryPolicyId?: number | null; receiptStorageKey?: string | null; receiptSha256?: string | null;
  organizationId?: number; employeeId?: number; submittedByUserId?: number | null;
  approvedByUserId?: number | null; approvedAt?: Date | null; policyMatched?: boolean;
  receiptByteSize?: number | null; receiptVerifiedAt?: Date | null;
};
export function reimbursementEligible(claim: ReimbursementClaimSnapshot, strict: boolean): boolean {
  return claim.status === "approved" && claim.payrollRunId == null &&
    (!strict || (claim.policyMatched === true && claim.categoryPolicyId != null &&
      !!claim.receiptStorageKey && receiptObjectIdentityMatches(claim.receiptStorageKey,
        claim.organizationId ?? 0, claim.employeeId ?? 0) && /^[a-f0-9]{64}$/.test(claim.receiptSha256 ?? "") &&
      Number.isSafeInteger(claim.submittedByUserId) && Number(claim.submittedByUserId) > 0 &&
      Number.isSafeInteger(claim.approvedByUserId) && Number(claim.approvedByUserId) > 0 &&
      claim.submittedByUserId !== claim.approvedByUserId && claim.approvedAt instanceof Date &&
      Number.isFinite(claim.approvedAt.getTime()) && claim.receiptVerifiedAt instanceof Date &&
      Number.isFinite(claim.receiptVerifiedAt.getTime()) &&
      Number.isSafeInteger(claim.receiptByteSize) && Number(claim.receiptByteSize) > 0 && Number(claim.receiptByteSize) <= 5242880 &&
      approvedReimbursementAmount(claim.approvedAmount, claim.amount) !== null));
}

/** Uses existing ordinary supplementary earnings; calculator math is unchanged. */
export function reimbursementPayrollInputs(claims: Array<ReimbursementClaimSnapshot & {
  id: number; category: string; description: string; incurredOn: string; taxable?: boolean;
}>, enabled: boolean) {
  if (enabled && claims.some(claim => !reimbursementEligible(claim, true))) {
    throw new Error("APPROVED_EXPENSE_EVIDENCE_REQUIRED");
  }
  const legacy = claims.map(claim => ({ id: claim.id, category: claim.category,
    description: claim.description, amount: Number(claim.amount), incurredOn: String(claim.incurredOn) }));
  return {
    expenses: enabled ? [] : legacy,
    supplementaryEarnings: enabled ? claims.filter(claim => reimbursementEligible(claim, true)).map(claim => ({
      id: claim.id, code: "EXP-" + claim.id, earningType: "expense_reimbursement",
      label: "Expense, " + claim.category, amount: Number(claim.approvedAmount), taxable: claim.taxable === true,
      includeInSssBase: false, includeInPagIbigBase: false,
      notes: ["Description: " + claim.description, "Incurred: " + claim.incurredOn,
        claim.taxable ? "Taxable reimbursement" : "Non-taxable reimbursement",
        "Receipt SHA-256: " + claim.receiptSha256, "Expense policy: " + claim.categoryPolicyId,
        "Expense approval: " + claim.approvedByUserId],
    })) : [],
  };
}
export function reimbursementSettlementDecision(
  claim: ReimbursementClaimSnapshot, runId: number, lineAmount: unknown, strict: boolean,
): "settle" | "already_settled" | "paid_elsewhere" | "not_approved" | "missing_evidence" | "amount_changed" {
  if (claim.payrollRunId != null && claim.payrollRunId !== runId) return "paid_elsewhere";
  if (claim.status === "paid" && claim.payrollRunId === runId) return "already_settled";
  if (claim.status !== "approved" || claim.payrollRunId !== null) return "not_approved";
  if (!reimbursementEligible(claim, strict)) return "missing_evidence";
  const payable = approvedReimbursementAmount(claim.approvedAmount ?? claim.amount, claim.amount);
  if (!payable || storedMoneyCentavos(payable) !== storedMoneyCentavos(lineAmount)) return "amount_changed";
  return "settle";
}

/** Never sign an object key outside the authorized claim's exact tenant/worker. */
export function receiptObjectIdentityMatches(key: string, organizationId: number, employeeId: number): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(employeeId) || employeeId <= 0) return false;
  const parts = key.split("/");
  return parts.length === 4 && parts[0] === "private-documents" &&
    parts[1] === String(organizationId) && parts[2] === String(employeeId) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parts[3]);
}

/** A private receipt is immutable after initial scan, before claim approval. */
export function claimCanAttachReceipt(claim: {
  status: string; payrollRunId: number | null; receiptStorageKey?: string | null;
}): boolean {
  return claim.status === "pending" && claim.payrollRunId === null && claim.receiptStorageKey === null;
}

/** Snapshot tax classification must agree with the rendered, approved payslip. */
export function reimbursementLineTaxMatches(taxable: boolean, notes: readonly string[]): boolean {
  const markers = notes.filter(note => note === "Taxable reimbursement" || note === "Non-taxable reimbursement");
  return markers.length === 1 && markers[0] === (taxable ? "Taxable reimbursement" : "Non-taxable reimbursement");
}


/** The actual payslip must reflect the reviewed reimbursement classification and
 * exclusion from contribution bases, not just retain a free-text tax marker. */
export function reimbursementLineBenefitTreatmentMatches(taxable: boolean, notes: readonly string[]): boolean {
  const markers = [
    "Type: expense_reimbursement",
    taxable ? "Tax treatment: taxable" : "Tax treatment: non-taxable",
    "Excluded from SSS contribution base",
    "Excluded from Pag-IBIG contribution base",
  ];
  return markers.every(marker => notes.filter(note => note === marker).length === 1) &&
    notes.filter(note => note.startsWith("Type: ")).length === 1 &&
    notes.filter(note => note.startsWith("Tax treatment: ")).length === 1 &&
    notes.filter(note => /^(Included|Excluded) (from|in) SSS contribution base$/.test(note)).length === 1 &&
    notes.filter(note => /^(Included|Excluded) (from|in) Pag-IBIG contribution base$/.test(note)).length === 1;
}

export function reimbursementLineEvidenceMatches(claim: ReimbursementClaimSnapshot, notes: readonly string[]) {
  return ["Receipt SHA-256: " + claim.receiptSha256, "Expense policy: " + claim.categoryPolicyId,
    "Expense approval: " + claim.approvedByUserId].every(marker => notes.filter(note => note === marker).length === 1) &&
    notes.filter(note => note.startsWith("Receipt SHA-256: ")).length === 1 &&
    notes.filter(note => note.startsWith("Expense policy: ")).length === 1 &&
    notes.filter(note => note.startsWith("Expense approval: ")).length === 1;
}
