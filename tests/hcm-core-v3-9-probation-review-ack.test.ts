import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  parseProbationReviewInput,
  probationReviewSnapshot,
} from "../src/lib/hcm-probation-reviews";

const read = (path: string) => readFileSync(path, "utf8");

test("Core 3.9 migration creates structured probation review, receipt acknowledgment, and event ledgers", () => {
  const migration = read("drizzle/0066_hcm_probation_review_acknowledgment.sql");
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_probation_reviews"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_probation_review_acknowledgments"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_probation_review_events"'));
  assert.ok(migration.includes("hcm_probation_reviews_term_unique"));
  assert.ok(migration.includes("hcm_probation_review_ack_unique"));
  assert.ok(migration.includes("acknowledged_receipt"));
  assert.ok(migration.includes("receipt-only-v1"));
});

test("probation review parser accepts bounded ratings and requires a complete review before submission", () => {
  const draft = parseProbationReviewInput({
    recommendation: "confirm_regular",
    overallRating: 5,
    roleExpectationsRating: 4,
    workQualityRating: 5,
    reliabilityRating: 4,
    conductCollaborationRating: 5,
    summary: "Consistently meets the role expectations documented for the probation period.",
    strengths: "Strong quality and reliability.",
    developmentAreas: "Continue documenting handoffs.",
  }, { requireComplete: true });

  assert.equal(draft.recommendation, "confirm_regular");
  assert.equal(draft.overallRating, 5);
  assert.equal(draft.summary?.startsWith("Consistently"), true);

  assert.throws(
    () => parseProbationReviewInput({ overallRating: 6 }),
    /whole numbers from 1 to 5/,
  );
  assert.throws(
    () => parseProbationReviewInput({
      recommendation: "confirm_regular",
      overallRating: 5,
      roleExpectationsRating: 4,
      workQualityRating: 5,
      reliabilityRating: 4,
      conductCollaborationRating: 5,
      summary: "short",
    }, { requireComplete: true }),
    /summary of at least 10 characters/,
  );
});

test("probation review snapshot keeps the submitted manager evidence deterministic", () => {
  const review = {
    id: 9,
    organizationId: 2,
    employeeId: 31,
    employmentTermId: 44,
    status: "submitted",
    recommendation: "needs_hr_review",
    overallRating: 4,
    roleExpectationsRating: 4,
    workQualityRating: 5,
    reliabilityRating: 3,
    conductCollaborationRating: 4,
    summary: "Review summary",
    strengths: "Quality",
    developmentAreas: "Reliability",
    reviewerUserId: 7,
    reviewerEmployeeId: 18,
    reviewerName: "Maria Manager",
    submittedAt: new Date("2026-10-07T01:00:00Z"),
    createdAt: new Date("2026-10-06T01:00:00Z"),
    updatedAt: new Date("2026-10-07T01:00:00Z"),
  } as any;

  const snapshot = probationReviewSnapshot(review);
  assert.equal(snapshot.id, 9);
  assert.equal(snapshot.ratings.workQuality, 5);
  assert.equal(snapshot.submittedAt, "2026-10-07T01:00:00.000Z");
});

test("manager review API is reporting-line scoped and protects the irreversible submit action", () => {
  const route = read("src/app/api/hcm/probation-reviews/route.ts");
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("positions.managerEmployeeId"));
  assert.ok(route.includes("This worker is not currently assigned to you as manager."));
  assert.ok(route.includes("enforceSameOriginMutation"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes('action === "submit"'));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes("Submitted probation reviews are immutable."));
  assert.ok(route.includes('inArray(hcmEmploymentTermDecisions.status, ["scheduled", "applied"])'));
});

test("structured review remains evidence only and cannot approve or mutate employment state", () => {
  const route = read("src/app/api/hcm/probation-reviews/route.ts");
  const source = read("src/lib/hcm-probation-reviews.ts");
  assert.ok(route.includes("A separate governed employment decision remains required."));
  assert.equal(route.includes("approveEmploymentDecisionWithEvidence"), false);
  assert.equal(route.includes("activateEmploymentTerm"), false);
  assert.equal(route.includes('status: "Separated"'), false);
  assert.equal(source.includes("activateEmploymentTerm"), false);
});

test("employee acknowledgment is session-bound receipt evidence and explicitly not agreement", () => {
  const route = read("src/app/api/self/probation-reviews/route.ts");
  assert.ok(route.includes('session.role !== "employee"'));
  assert.ok(route.includes("session.employeeId"));
  assert.ok(route.includes("assertMembership"));
  assert.ok(route.includes("enforceSameOriginMutation"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes('"acknowledged_receipt"'));
  assert.ok(route.includes('"receipt-only-v1"'));
  assert.ok(route.includes("does not mean you agree"));
  assert.ok(route.includes("does not indicate agreement"));
});

test("evidence packet v3 seals submitted probation review while preserving v1 and v2 verification", () => {
  const source = read("src/lib/hcm-employment-decision-evidence.ts");
  assert.ok(source.includes("proposalSnapshotV1"));
  assert.ok(source.includes("proposalSnapshotV2"));
  assert.ok(source.includes("proposalSnapshotV3"));
  assert.ok(source.includes('"hcm-employment-decision-evidence-v3"'));
  assert.ok(source.includes('"hcm-employment-decision-packet-v1"'));
  assert.ok(source.includes('"hcm-employment-decision-packet-v2"'));
  assert.ok(source.includes('"hcm-employment-decision-packet-v3"'));
  assert.ok(source.includes('eq(hcmProbationReviews.status, "submitted")'));
  assert.ok(source.includes("structuredProbationReviewId"));
  assert.ok(source.includes('evidencePacketVersion: "v3"'));
});

test("employee receipt acknowledgment stays outside the sealed approval hash", () => {
  const source = read("src/lib/hcm-employment-decision-evidence.ts");
  const v3Start = source.indexOf("function proposalSnapshotV3");
  const loadPacketStart = source.indexOf("export async function loadEmploymentDecisionEvidencePacket");
  assert.ok(v3Start >= 0);
  assert.ok(loadPacketStart > v3Start);

  const v3Block = source.slice(v3Start, loadPacketStart);
  assert.ok(v3Block.includes("probationReview"));
  assert.equal(v3Block.includes("hcmProbationReviewAcknowledgments"), false);

  const packetBlock = source.slice(loadPacketStart, source.indexOf("export async function recordEmploymentDecisionEvidenceEvent"));
  assert.ok(packetBlock.includes("probationReviewAcknowledgment"));
  assert.ok(packetBlock.includes("hcmProbationReviewAcknowledgments"));
});

test("Core 3.8 current-manager attestation gate remains authoritative after structured review is added", () => {
  const source = read("src/lib/hcm-employment-decision-evidence.ts");
  assert.ok(source.includes("requireManagerReviewForProbation"));
  assert.ok(source.includes("currentManagerAttestation"));
  assert.ok(source.includes("worker's current manager before approving a probation decision"));
  assert.ok(source.includes("managerAttestationCount"));
});

test("People workspace and employee home expose both sides of the governed review flow", () => {
  const worker = read("src/components/hcm-employment-lifecycle-worker.tsx");
  const managerPanel = read("src/components/hcm-probation-review-panel.tsx");
  const selfPortal = read("src/components/self-service-portal.tsx");
  const selfPanel = read("src/components/hcm-self-probation-reviews.tsx");

  assert.ok(worker.includes("HcmProbationReviewPanel"));
  assert.ok(managerPanel.includes("Submit & lock review"));
  assert.ok(managerPanel.includes("separate governed employment decision"));
  assert.ok(selfPortal.includes("HcmSelfProbationReviews"));
  assert.ok(selfPanel.includes("Acknowledge receipt"));
  assert.ok(selfPanel.includes("does not mean I agree"));
});

test("decision evidence UI distinguishes sealed review evidence from later receipt acknowledgment", () => {
  const component = read("src/components/hcm-employment-decision-evidence.tsx");
  assert.ok(component.includes("STRUCTURED PROBATION REVIEW"));
  assert.ok(component.includes("Receipt acknowledged"));
  assert.ok(component.includes("outside the sealed approval hash"));
});
