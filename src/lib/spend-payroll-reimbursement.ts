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

/** A private receipt is immutable after initial scan, before claim approval. */
export function claimCanAttachReceipt(claim: {
  status: string; payrollRunId: number | null; receiptStorageKey: string | null;
}): boolean {
  return claim.status === "pending" && claim.payrollRunId === null && claim.receiptStorageKey === null;
}
