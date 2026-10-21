import assert from "node:assert/strict";
import test from "node:test";
import { isScopedProbationReviewEnvelope, probationReviewReadActions } from "../src/lib/hcm-probation-review-read-state";

const empty = {
  organizationId: 4, canManage: true, mutable: true, review: null,
  acknowledgment: null, events: [], guardrail: "Evidence only",
  employee: { id: 9 }, term: { id: 22, employeeId: 9, organizationId: 4, termKind: "probationary" },
};
const review = {
  id: 7, organizationId: 4, employeeId: 9, employmentTermId: 22,
  status: "draft", recommendation: null, overallRating: null,
  roleExpectationsRating: null, workQualityRating: null,
  reliabilityRating: null, conductCollaborationRating: null,
  summary: null, strengths: null, developmentAreas: null,
  reviewerName: "Manager", submittedAt: null,
};
test("probation read must match employer, worker and exact term", () => {
  assert.equal(isScopedProbationReviewEnvelope(empty, 4, 9, 22), true);
  assert.equal(isScopedProbationReviewEnvelope(empty, 5, 9, 22), false);
  assert.equal(isScopedProbationReviewEnvelope(empty, 4, 10, 22), false);
  assert.equal(isScopedProbationReviewEnvelope(empty, 4, 9, 23), false);
  assert.equal(isScopedProbationReviewEnvelope({ ...empty, organizationId: undefined }, 4, 9, 22), false);
  assert.equal(isScopedProbationReviewEnvelope({ ...empty, review: undefined }, 4, 9, 22), false);
  assert.equal(isScopedProbationReviewEnvelope({ ...empty, events: undefined }, 4, 9, 22), false);
});
test("probation draft actions require verified review fields; retry is a new read", () => {
  const draft = { ...empty, review };
  assert.equal(isScopedProbationReviewEnvelope(draft, 4, 9, 22), true);
  assert.equal(isScopedProbationReviewEnvelope({ ...draft, review: { ...review, employeeId: 15 } }, 4, 9, 22), false);
  assert.equal(isScopedProbationReviewEnvelope({ ...draft, review: { ...review, overallRating: 7 } }, 4, 9, 22), false);
  assert.equal(isScopedProbationReviewEnvelope({ ...draft, review: { ...review, status: "submitted" } }, 4, 9, 22), false);
  assert.equal(isScopedProbationReviewEnvelope({ ...draft, mutable: false }, 4, 9, 22), true);
  assert.equal(isScopedProbationReviewEnvelope(draft, 4, 9, 22), true);
});

test("locked probation reads remain verified but never show write actions", () => {
  const lockedEmpty = { ...empty, mutable: false };
  assert.equal(isScopedProbationReviewEnvelope(lockedEmpty, 4, 9, 22), true);
  const emptyActions = probationReviewReadActions("ready", lockedEmpty);
  assert.equal(emptyActions.canOpen, false);
  assert.equal(emptyActions.canEdit, false);
  const lockedDraft = { ...empty, review, mutable: false };
  assert.equal(isScopedProbationReviewEnvelope(lockedDraft, 4, 9, 22), true);
  const draftActions = probationReviewReadActions("ready", lockedDraft);
  assert.equal(draftActions.canOpen, false);
  assert.equal(draftActions.canEdit, false);
  assert.equal(draftActions.showReadOnlyDraft, true);
  const submitted = { ...review, status: "submitted", submittedAt: "2026-10-21T00:00:00Z",
    recommendation: "confirm_regular", overallRating: 4, roleExpectationsRating: 4,
    workQualityRating: 4, reliabilityRating: 4, conductCollaborationRating: 4 };
  assert.equal(isScopedProbationReviewEnvelope({ ...empty, review: submitted, mutable: false }, 4, 9, 22), true);
  assert.equal(isScopedProbationReviewEnvelope({ ...empty, review: submitted, mutable: true }, 4, 9, 22), false);
});
