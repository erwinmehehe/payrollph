import assert from "node:assert/strict";
import test from "node:test";
import {
  externalAccessRevoked, isOffboardingDepartment, offboardingClearanceStatus,
  waiverEvidenceValid, waiverReviewerEligible,
} from "../src/lib/offboarding-clearance";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

const record = {
  organizationId: 44, id: 91,
  itCleared: true, adminCleared: false, financeCleared: true, hrCleared: true,
};
const waiver = {
  organizationId: 44, separationId: 91, department: "admin",
  reason: "Equipment replacement charge reviewed and waived by Finance.",
  evidenceReference: "WAIVER-2026-10-12-001", revokedAt: null,
};
test("A-6 is default-off and only exact literal true activates it", () => {
  assert.equal(criticalReleaseFlagEnabled("offboardingClearance", {}), false);
  assert.equal(criticalReleaseFlagEnabled("offboardingClearance", { OFFBOARDING_CLEARANCE_ENABLED: "TRUE" }), false);
  assert.equal(criticalReleaseFlagEnabled("offboardingClearance", { OFFBOARDING_CLEARANCE_ENABLED: "true" }), true);
});
test("no final-pay release while a department remains uncleared and unwaived", () => {
  assert.deepEqual(offboardingClearanceStatus(record, []), { ready: false, missing: ["admin"], waived: [] });
  assert.deepEqual(offboardingClearanceStatus(record, [waiver]), { ready: true, missing: [], waived: ["admin"] });
  assert.equal(offboardingClearanceStatus(record, [{ ...waiver, revokedAt: new Date() }]).ready, false);
  assert.equal(offboardingClearanceStatus(record, [{ ...waiver, organizationId: 45 }]).ready, false);
  assert.equal(offboardingClearanceStatus(record, [{ ...waiver, separationId: 92 }]).ready, false);
  assert.equal(offboardingClearanceStatus(record, [{ ...waiver, reason: "Too short" }]).ready, false);
});
test("waiver is a review, not self-approved preparer authority", () => {
  assert.equal(waiverReviewerEligible({
    role: "admin", companyWide: true, actorUserId: 10, preparedByUserId: 9,
  }), true);
  assert.equal(waiverReviewerEligible({
    role: "admin", companyWide: true, actorUserId: 9, preparedByUserId: 9,
  }), false);
  assert.equal(waiverReviewerEligible({
    role: "admin", companyWide: false, actorUserId: 10, preparedByUserId: 9,
  }), false);
  assert.equal(waiverReviewerEligible({
    role: "payroll", companyWide: true, actorUserId: 10, preparedByUserId: 9,
  }), false);
  assert.equal(waiverReviewerEligible({
    role: "owner", companyWide: true, actorUserId: 10, preparedByUserId: null,
  }), false);
  assert.equal(waiverEvidenceValid("A thoroughly investigated waiver reason", "HR-REF-987654"), true);
  assert.equal(waiverEvidenceValid("Short", "HR-REF-987654"), false);
  assert.equal(isOffboardingDepartment("it"), true);
  assert.equal(isOffboardingDepartment("payroll"), false);
});
test("IT must have zero non-revoked grants even when equipment custody is waived", () => {
  assert.equal(externalAccessRevoked([]), true);
  assert.equal(externalAccessRevoked(["revoked", "revoked"]), true);
  for (const state of ["active", "revoke_requested", "grant_requested"]) {
    assert.equal(externalAccessRevoked(["revoked", state]), false);
  }
});
