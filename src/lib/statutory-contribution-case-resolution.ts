export type ContributionIssueType =
  | "missing_posting"
  | "wrong_posted_amount"
  | "unexpected_deduction"
  | "missing_payslip_evidence"
  | "other";

export type ContributionResolutionOutcome =
  | "posting_confirmed"
  | "correction_completed"
  | "no_issue_found"
  | "employee_advised"
  | "referred_to_agency";

const POLICY: Record<ContributionIssueType, readonly ContributionResolutionOutcome[]> = {
  missing_posting: ["posting_confirmed", "correction_completed", "referred_to_agency"],
  wrong_posted_amount: ["posting_confirmed", "correction_completed", "referred_to_agency"],
  unexpected_deduction: ["correction_completed", "no_issue_found", "employee_advised", "referred_to_agency"],
  missing_payslip_evidence: ["no_issue_found", "employee_advised"],
  other: ["posting_confirmed", "correction_completed", "no_issue_found", "employee_advised", "referred_to_agency"],
};

export function allowedContributionCaseOutcomes(
  issueType: string,
  options?: { hasLinkedPosting?: boolean },
) {
  const base = POLICY[issueType as ContributionIssueType] ?? POLICY.other;
  if (
    options?.hasLinkedPosting === false
    && (issueType === "missing_posting" || issueType === "wrong_posted_amount")
  ) {
    return ["referred_to_agency"] as const;
  }
  return base;
}

export function contributionCaseOutcomeAllowed(
  issueType: string,
  outcome: string,
  options?: { hasLinkedPosting?: boolean },
) {
  return allowedContributionCaseOutcomes(issueType, options)
    .includes(outcome as ContributionResolutionOutcome);
}

export function contributionCaseResolutionPolicyMessage(issueType: string) {
  if (issueType === "missing_posting" || issueType === "wrong_posted_amount") {
    return "Posting disputes may only close after a linked agency posting is confirmed or an audited member-posting correction is completed. If no linked posting record exists, refer the case to the agency and keep it open.";
  }
  if (issueType === "missing_payslip_evidence") {
    return "Payslip-evidence cases should be resolved by verifying the evidence or advising the employee; remittance posting outcomes do not apply.";
  }
  return "Choose a resolution outcome that matches the reported issue and the evidence actually verified.";
}
