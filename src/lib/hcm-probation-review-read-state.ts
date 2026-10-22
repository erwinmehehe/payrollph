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
  const packet = value as unknown as Record<string, unknown>;
  if (packet.organizationId !== organizationId || packet.canManage !== true
      || typeof packet.guardrail !== "string" || !Array.isArray(packet.events)
      || !isObject(packet.employee) || packet.employee.id !== employeeId
      || !isObject(packet.term) || packet.term.id !== employmentTermId
      || packet.term.employeeId !== employeeId || packet.term.organizationId !== organizationId
      || packet.term.termKind !== "probationary") return false;
  if (packet.review === null) {
    return packet.acknowledgment === null && packet.events.length === 0;
  }
  const review = packet.review;
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
      || (review.status === "submitted" && packet.mutable !== false)) return false;
  if (review.status === "submitted" &&
      (review.submittedAt === null || review.recommendation === null ||
       ["overallRating", "roleExpectationsRating", "workQualityRating",
         "reliabilityRating", "conductCollaborationRating"].some(
         (key) => review[key] === null))) return false;
  if (packet.acknowledgment !== null) {
    const a = packet.acknowledgment;
    if (!isObject(a) || !id(a.id) || a.reviewId !== review.id
        || typeof a.response !== "string" || !optionalString(a.employeeComment)
        || typeof a.acknowledgedByName !== "string" || !reviewDate(a.createdAt)) return false;
  }
  return packet.events.every((event: unknown) =>
    isObject(event) && event.organizationId === organizationId
      && event.employeeId === employeeId && event.reviewId === review.id && id(event.id));
}
