export type ContributionDisputeResolutionCode =
  | "posted_confirmed"
  | "corrected"
  | "not_an_error"
  | "duplicate";

export type ContributionPostingEvidence = {
  postingStatus: string;
  postedAmount: string | number | null;
  totalContribution: string | number;
};

export function validateContributionDisputeResolution(input: {
  resolutionCode: ContributionDisputeResolutionCode;
  member: ContributionPostingEvidence | null;
}) {
  if (input.resolutionCode !== "posted_confirmed" && input.resolutionCode !== "corrected") {
    return { ok: true as const };
  }

  if (!input.member) {
    return {
      ok: false as const,
      error: "This report cannot be marked corrected until a remittance member posting record exists.",
    };
  }

  const expected = Number(input.member.totalContribution);
  const posted = Number(input.member.postedAmount);
  if (
    input.member.postingStatus !== "confirmed"
    || input.member.postedAmount == null
    || !Number.isFinite(expected)
    || !Number.isFinite(posted)
    || Math.abs(posted - expected) > 0.01
  ) {
    return {
      ok: false as const,
      error: "Corrected resolution requires a confirmed agency posting whose amount matches the expected contribution.",
    };
  }

  return { ok: true as const };
}
