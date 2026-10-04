import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveOvertimeAuthorization,
  resolveOvertimeAuthorizationDay,
} from "../src/lib/workforce-overtime";

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


test("daily OT evidence fails closed when multiple authorization requests exist", () => {
  const result = resolveOvertimeAuthorizationDay({
    actualOvertimeMinutes: 120,
    requests: [
      {
        id: 21,
        status: "approved",
        requestKind: "pre_approved",
        requestedMinutes: 120,
        requestedByUserId: 7,
        decidedByUserId: 8,
      },
      {
        id: 22,
        status: "pending",
        requestKind: "emergency_post_approval",
        requestedMinutes: 30,
        requestedByUserId: 7,
        decidedByUserId: null,
      },
    ],
  });

  assert.equal(result.authorizedMinutes, 0);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "multiple_requests");
  assert.equal(result.payrollEntitlementIndependent, true);
  assert.deepEqual(result.requests.map((request) => request.id), [21, 22]);
});

test("daily OT evidence records missing authorization without changing wage entitlement", () => {
  const result = resolveOvertimeAuthorizationDay({
    actualOvertimeMinutes: 45,
    requests: [],
  });

  assert.equal(result.authorizedMinutes, 0);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "missing_request");
  assert.equal(result.actualOvertimeMinutes, 45);
  assert.equal(result.payrollEntitlementIndependent, true);
});

test("daily OT evidence records approved minutes and flags only the excess", () => {
  const result = resolveOvertimeAuthorizationDay({
    actualOvertimeMinutes: 90,
    requests: [{
      id: 25,
      status: "approved",
      requestKind: "pre_approved",
      requestedMinutes: 60,
      requestedByUserId: 7,
      decidedByUserId: 8,
    }],
  });

  assert.equal(result.authorizedMinutes, 60);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reviewReason, "exceeds_approved_minutes");
  assert.equal(result.actualOvertimeMinutes, 90);
});

test("unused approved OT is audit evidence but does not block payroll", () => {
  const result = resolveOvertimeAuthorizationDay({
    actualOvertimeMinutes: 0,
    requests: [{
      id: 26,
      status: "approved",
      requestKind: "pre_approved",
      requestedMinutes: 120,
      requestedByUserId: 7,
      decidedByUserId: 8,
    }],
  });

  assert.equal(result.reviewRequired, false);
  assert.equal(result.reviewReason, "none");
  assert.equal(result.authorizedMinutes, 0);
});
