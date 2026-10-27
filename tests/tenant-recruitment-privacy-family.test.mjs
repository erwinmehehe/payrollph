import assert from "node:assert/strict";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/recruitment-privacy.mjs";

const [row] = createRows({ assert });
const own = {
  orgId: 11, marker: "FICTIONAL-RECRUIT-A", owner: { id: 31, name: "Fictional privacy owner" },
  seeded: { id: 41 }, victim: { org: { id: 99 } }, victimSeeded: { id: 141 },
};
const requestedReason = "Documented fictional applicant deletion request for " + own.marker;

function evidence() {
  const requisition = { id: 21, organizationId: 11, title: own.marker + " fictional privacy requisition" };
  const applicant = { id: 41, organizationId: 11, requisitionId: 21,
    fullName: own.marker + " fictional applicant", stage: "applied", resumeUrl: null };
  const privacy = { id: 51, organizationId: 11, applicantId: 41, legalBasis: "consent",
    privacyNoticeVersion: "fictional-v1", consentCapturedAt: "2026-01-01T00:00:00.000Z",
    sourceEvidenceReference: "fictional-source", legalHold: false, purgedAt: null,
    purgedByUserId: null, deletionRequestedByUserId: null, deletionRequestedAt: null,
    deletionReason: null, deletionReviewedByUserId: null, deletionReviewedAt: null,
    deletionReviewEvidenceReference: null, rejectedAt: null };
  const oldAudit = { id: 61, organizationId: 11, actor: "Prior owner", action: "Earlier event",
    resource: "Fictional", metadata: {} };
  const before = { requisitions: [requisition], applicants: [applicant],
    privacy: [privacy], audit: [oldAudit] };
  const after = { requisitions: [requisition], applicants: [applicant],
    privacy: [{ ...privacy, deletionRequestedByUserId: 31,
      deletionRequestedAt: "2026-10-27T00:00:00.000Z", deletionReason: requestedReason }],
    audit: [oldAudit, { id: 62, organizationId: 11, actor: own.owner.name,
      action: "Candidate PII deletion requested", resource: "Applicant #41",
      metadata: { applicantId: 41, requesterUserId: 31 } }] };
  return { before: structuredClone(before), after: structuredClone(after),
    response: { json: { status: "requested", applicantId: 41 } } };
}

test("single flagged Recruitment privacy PATCH row is a request only", () => {
  assert.equal(row.key, "PATCH recruitment/privacy");
  assert.equal(row.profile, "flagged-reads");
  assert.deepEqual(row.flags, ["APPLICANT_PRIVACY_CONTROLS_ENABLED"]);
  assert.ok(row.seed && row.state && row.ownBody && row.foreignBody && row.expect);
  assert.deepEqual(row.ownBody(own), {
    organizationId: 11, applicantId: 41, action: "request_delete", reason: requestedReason,
  });
  assert.deepEqual(row.foreignBody(own), {
    organizationId: 99, applicantId: 141, action: "request_delete", reason: requestedReason,
  });
  assert.equal(row.forged.status, 404);
  assert.deepEqual(row.forged.body(own), {
    organizationId: 11, applicantId: 141, action: "request_delete", reason: requestedReason,
  });
  assert.ok(141 > 41, "foreign candidate ID is genuine and higher in runner");
  assert.ok(requestedReason.length >= 20 && requestedReason.length <= 500);
});

test("accepts exact actor-bound persisted request; rejects a no-op and wrong employer", () => {
  const e = evidence();
  row.expect(e.before, e.after, own, e.response);
  assert.throws(() => row.expect(e.before, e.before, own, e.response));
  assert.throws(() => row.expect(e.before, e.after, { ...own, orgId: 99 }, e.response));
  assert.throws(() => row.expect(e.before, e.after, { ...own, seeded: { id: 999 } }, e.response));
  assert.throws(() => row.expect(e.before, e.after, own, { json: { status: "requested", applicantId: 141 } }));
  assert.throws(() => row.expect(e.before, e.after, own, { json: { status: "erased", applicantId: 41 } }));
});

test("rejects erasure, unauthorized review, altered candidate PII or extra privacy writes", () => {
  const tamper = [
    x => { x.after.applicants[0].fullName = "LEAKED"; },
    x => { x.after.applicants[0].stage = "rejected"; },
    x => { x.after.requisitions[0].title = "CHANGED"; },
    x => { x.after.privacy[0].purgedAt = "2026-10-27T00:00:00.000Z"; },
    x => { x.after.privacy[0].deletionReviewedByUserId = 32; },
    x => { x.after.privacy[0].legalHold = true; },
    x => { x.after.privacy[0].deletionRequestedByUserId = 999; },
    x => { x.after.privacy[0].deletionRequestedAt = "not-a-date"; },
    x => { x.after.privacy[0].deletionReason = "wrong candidate"; },
    x => { x.after.privacy.push({ ...x.after.privacy[0], id: 999 }); },
  ];
  for (const change of tamper) {
    const x = evidence(); change(x);
    assert.throws(() => row.expect(x.before, x.after, own, x.response));
  }
});

test("rejects missing/rewritten or foreign audit evidence", () => {
  const tamper = [
    x => { x.after.audit.pop(); },
    x => { x.after.audit[0].resource = "prior event tampered"; },
    x => { x.after.audit[1].organizationId = 99; },
    x => { x.after.audit[1].actor = "foreign user"; },
    x => { x.after.audit[1].resource = "Applicant #141"; },
    x => { x.after.audit[1].action = "Candidate PII erasure applied after independent review"; },
    x => { x.after.audit[1].metadata = { applicantId: 141, requesterUserId: 31 }; },
  ];
  for (const change of tamper) {
    const x = evidence(); change(x);
    assert.throws(() => row.expect(x.before, x.after, own, x.response));
  }
});
