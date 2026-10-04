import assert from "node:assert/strict";
import test from "node:test";
import { resolveOvertimeAuthorization } from "../src/lib/workforce-overtime";

test("approved overtime authorizes up to the approved request without changing payroll entitlement", () => {
  const result = resolveOvertimeAuthorization({
    actualOvertimeMinutes: 120,
    request: {
      id: 7,
      status: "approved",
      requestKind: "pre_approved",
      requestedMinutes: 120,
    },
  });

  assert.equal(result.authorizedMinutes, 120);
  assert.equal(result.reviewRequired, false);
  assert.equal(result.payrollEntitlementIndependent, true);
});

test("worked overtime without approval is flagged for review, not zeroed", () => {
  const result = resolveOvertimeAuthorization({
    actualOvertimeMinutes: 90,
    request: null,
  });

  assert.equal(result.authorizedMinutes, 0);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.payrollEntitlementIndependent, true);
});

test("worked overtime beyond an approved cap remains a review exception", () => {
  const result = resolveOvertimeAuthorization({
    actualOvertimeMinutes: 150,
    request: {
      id: 9,
      status: "approved",
      requestKind: "pre_approved",
      requestedMinutes: 120,
    },
  });

  assert.equal(result.authorizedMinutes, 120);
  assert.equal(result.reviewRequired, true);
});

test("rejected emergency-post request does not erase actual overtime", () => {
  const result = resolveOvertimeAuthorization({
    actualOvertimeMinutes: 60,
    request: {
      id: 11,
      status: "rejected",
      requestKind: "emergency_post_approval",
      requestedMinutes: 60,
    },
  });

  assert.equal(result.authorizedMinutes, 0);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.payrollEntitlementIndependent, true);
});
