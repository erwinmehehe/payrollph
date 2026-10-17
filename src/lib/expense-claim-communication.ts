/** Expense approval is an administrative decision, not a payroll settlement. */
export function expenseClaimDecisionNotice(status: "approved" | "rejected"): string {
  if (status === "rejected") return "Claim rejected.";
  return "Claim approved. Reimbursement, if enabled, is handled separately during reviewed payroll settlement.";
}
