/**
 * Truthful read-only status for a scoped probation review.
 *
 * A missing/failed authorization or a malformed 200 response must never
 * look like a verified "no review yet" and must never expose draft actions.
 * This is a UI gate only; server permissions remain authoritative.
 */
export type ProbationReviewReadPhase = "loading" | "ready" | "unavailable";

export type ProbationReviewReadEnvelope = {
  review: null | { status: "draft" | "submitted" };
  canManage: boolean;
  mutable: boolean;
};

export function isProbationReviewReadEnvelope(value: unknown): value is ProbationReviewReadEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(candidate, "review") ||
      typeof candidate.canManage !== "boolean" ||
      typeof candidate.mutable !== "boolean") return false;
  if (candidate.review === null) return true;
  if (!candidate.review || typeof candidate.review !== "object" ||
      Array.isArray(candidate.review)) return false;
  const status = (candidate.review as Record<string, unknown>).status;
  return status === "draft" || status === "submitted";
}

export function probationReviewReadActions(
  phase: ProbationReviewReadPhase,
  payload: ProbationReviewReadEnvelope | null,
) {
  const ready = phase === "ready" && payload !== null;
  const review = ready ? payload.review : null;
  const canMutate = ready && payload.canManage && payload.mutable;
  return {
    loading: phase === "loading",
    unavailable: phase === "unavailable",
    canOpen: canMutate && review === null,
    canEdit: canMutate && review?.status === "draft",
    showReadOnlyDraft: ready && review?.status === "draft" && !canMutate,
    showSubmitted: ready && review?.status === "submitted",
    showUnavailablePermission: ready && review === null && !canMutate,
  };
}
