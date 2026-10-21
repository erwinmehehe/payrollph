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


const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const optionalString = (value: unknown) =>
  value === null || typeof value === "string";
const reviewDate = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalRating = (value: unknown) =>
  value === null || (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 5);

/**
 * Server response identity and displayed record proof. The loose envelope
 * above remains for read-action state tests; it is not a tenant authorization.
 */
export function isScopedProbationReviewEnvelope(
  value: unknown, organizationId: number, employeeId: number, employmentTermId: number,
): boolean {
  if (!id(organizationId) || !id(employeeId) || !id(employmentTermId) ||
      !isProbationReviewReadEnvelope(value) || !isObject(value)) return false;
  if (value.organizationId !== organizationId || value.canManage !== true
      || typeof value.guardrail !== "string" || !Array.isArray(value.events)
      || !isObject(value.employee) || value.employee.id !== employeeId
      || !isObject(value.term) || value.term.id !== employmentTermId
      || value.term.employeeId !== employeeId || value.term.organizationId !== organizationId
      || value.term.termKind !== "probationary") return false;
  if (value.review === null) {
    return value.acknowledgment === null && value.events.length === 0 && value.mutable === true;
  }
  const review = value.review;
  if (!isObject(review) || !id(review.id)
      || review.organizationId !== organizationId || review.employeeId !== employeeId
      || review.employmentTermId !== employmentTermId
      || !["draft", "submitted"].includes(String(review.status))
      || ![null, "confirm_regular", "non_renew", "needs_hr_review"].includes(
        review.recommendation as string | null)
      || !["overallRating", "roleExpectationsRating", "workQualityRating",
        "reliabilityRating", "conductCollaborationRating"].every(
        (key) => optionalRating(review[key]))
      || !["summary", "strengths", "developmentAreas"].every(
        (key) => optionalString(review[key]))
      || typeof review.reviewerName !== "string"
      || !(review.submittedAt === null || reviewDate(review.submittedAt))
      || value.mutable !== (review.status === "draft")) return false;
  if (review.status === "submitted" &&
      (review.submittedAt === null || review.recommendation === null ||
       ["overallRating", "roleExpectationsRating", "workQualityRating",
         "reliabilityRating", "conductCollaborationRating"].some(
         (key) => review[key] === null))) return false;
  if (value.acknowledgment !== null) {
    const a = value.acknowledgment;
    if (!isObject(a) || !id(a.id) || a.reviewId !== review.id
        || typeof a.response !== "string" || !optionalString(a.employeeComment)
        || typeof a.acknowledgedByName !== "string" || !reviewDate(a.createdAt)) return false;
  }
  return value.events.every((event: unknown) =>
    isObject(event) && event.organizationId === organizationId
      && event.employeeId === employeeId && event.reviewId === review.id && id(event.id));
}
