import assert from "node:assert/strict";
import test from "node:test";
import { assertCorrectableEmploymentChange, correctionDate, correctionFingerprint, correctionNote } from "../src/lib/hcm-effective-correction-policy";

const source = {
  movementType: "employment_type_change", targetPositionId: null, toSnapshot: { changes: { employmentType: "Regular" } },
  targetEmploymentType: "Regular", targetOrgUnitId: null, targetSupervisoryOrgUnitId: null, targetLegalEntityId: null,
  targetCostCenterId: null, targetManagerEmployeeId: null, targetEmployeeStatus: null, targetFte: null,
  approvedByUserId: null, approvedAt: null, appliedAt: null,
};
test("correction lane refuses other sources, extra intent, approval evidence and applied history", () => {
  assert.doesNotThrow(() => assertCorrectableEmploymentChange(source));
  for (const patch of [{ movementType: "promotion" }, { targetPositionId: 2 }, { targetFte: "1.0000" },
    { targetLegalEntityId: 4 }, { approvedByUserId: 3 }, { approvedAt: new Date() }, { appliedAt: new Date() },
    { targetEmploymentType: "Unmatched" }, { toSnapshot: {} },
    { toSnapshot: { changes: { employmentType: "Regular", employeeStatus: "Active" } } }]) {
    assert.throws(() => assertCorrectableEmploymentChange({ ...source, ...patch }), /Only unapplied/);
  }
});
test("correction notes and dates are explicit, bounded, real and never backdated", () => {
  assert.equal(correctionNote("  Correct the requested effective date.  "), "Correct the requested effective date.");
  for (const value of [null, {}, "", "short", "x".repeat(501)]) assert.throws(() => correctionNote(value));
  assert.equal(correctionDate("2028-02-29", "2028-02-28"), "2028-02-29");
  for (const value of ["2026-02-29", "2028-02-30", "2028-2-29", "2028-02-27", "0000-01-01", null]) assert.throws(() => correctionDate(value, "2028-02-28"));
});
test("audit fingerprint binds the complete original source and target evidence", () => {
  const original = { from: { employee: { id: 2, employmentType: "Probationary" } }, to: source.toSnapshot };
  const hash = correctionFingerprint(original); assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, correctionFingerprint(structuredClone(original)));
  assert.notEqual(hash, correctionFingerprint({ ...original, to: { changes: { employmentType: "Casual" } } }));
});
