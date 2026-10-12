import { storedMoneyCentavos } from "@/lib/stored-money-centavos";

export function approvedReimbursementAmount(value: unknown, submitted: unknown): string | null {
  const cents = storedMoneyCentavos(value), cap = storedMoneyCentavos(submitted);
  return cents !== null && cap !== null && cents > 0 && cents <= cap ? (cents / 100).toFixed(2) : null;
}
export type ReimbursementClaimSnapshot = {
  status: string; payrollRunId: number | null; amount: unknown; approvedAmount: unknown;
  categoryPolicyId: number | null; receiptStorageKey: string | null; receiptSha256: string | null;
};
export function reimbursementEligible(claim: ReimbursementClaimSnapshot, strict: boolean): boolean {
  return claim.status === "approved" && claim.payrollRunId == null &&
    (!strict || (claim.categoryPolicyId != null && !!claim.receiptStorageKey && !!claim.receiptSha256 &&
      approvedReimbursementAmount(claim.approvedAmount, claim.amount) !== null));
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
  status: string; payrollRunId: number | null; receiptStorageKey: string | null;
}): boolean {
  return claim.status === "pending" && claim.payrollRunId === null && claim.receiptStorageKey === null;
}

/** Snapshot tax classification must agree with the rendered, approved payslip. */
export function reimbursementLineTaxMatches(taxable: boolean, notes: readonly string[]): boolean {
  const markers = notes.filter(note => note === "Taxable reimbursement" || note === "Non-taxable reimbursement");
  return markers.length === 1 && markers[0] === (taxable ? "Taxable reimbursement" : "Non-taxable reimbursement");
}
