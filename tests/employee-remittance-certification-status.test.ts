import assert from "node:assert/strict";
import test from "node:test";
import { employeeCertificationStatus } from "../src/lib/statutory-remittance-close-state";

test("valid matching closure is shown to employees as certified", () => {
  const status = employeeCertificationStatus({
    certificationValid: true,
    evaluationReady: true,
    closure: {
      status: "certified",
      certifiedAt: "2026-10-05T00:00:00.000Z",
      invalidatedAt: null,
    },
  });
  assert.equal(status.status, "certified");
  assert.equal(status.label, "Certified");
  assert.equal(status.needsRecertification, false);
  assert.equal(status.certifiedAt, "2026-10-05T00:00:00.000Z");
});

test("stale or invalidated prior closure is shown as under review", () => {
  const status = employeeCertificationStatus({
    certificationValid: false,
    evaluationReady: false,
    closure: {
      status: "invalidated",
      certifiedAt: "2026-10-01T00:00:00.000Z",
      invalidatedAt: "2026-10-05T00:00:00.000Z",
    },
  });
  assert.equal(status.status, "under_review");
  assert.equal(status.label, "Under review");
  assert.equal(status.needsRecertification, true);
  assert.equal(status.certifiedAt, null);
});

test("fully reconciled month awaiting independent review is not falsely called certified", () => {
  const status = employeeCertificationStatus({
    certificationValid: false,
    evaluationReady: true,
    closure: null,
  });
  assert.equal(status.status, "ready_for_review");
  assert.equal(status.label, "Awaiting certification");
});

test("month with blockers and no prior closure stays not certified", () => {
  const status = employeeCertificationStatus({
    certificationValid: false,
    evaluationReady: false,
    closure: null,
  });
  assert.equal(status.status, "not_certified");
  assert.equal(status.label, "Not yet certified");
});
