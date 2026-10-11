import assert from "node:assert/strict";
import test from "node:test";
import { separationLeaveAllowance, validateSeparationLeaveCredits, type SeparationLeaveSources } from "../src/lib/separation-leave";
const sources = (): SeparationLeaveSources => ({
  balances: [{ id: 1, leaveType: "Vacation leave", year: 2026, opening: "5", accrued: "10", used: "3", pending: "2" }],
  policies: [{ id: 2, leaveType: "Vacation leave", annualDays: "15", active: true, conversionCap: 5 }],
  conversions: [{ id: 3, leaveType: "Vacation leave", daysConverted: "2", status: "approved", createdAt: "2026-04-01T00:00:00Z" }],
});
test("separation cash credits honor balance, pending leave, reservations and employer cap", () => {
  const result = separationLeaveAllowance(sources(), "Vacation leave", 2026);
  assert.equal(result.available, 10);
  assert.equal(result.convertible, 3);
  assert.doesNotThrow(() => validateSeparationLeaveCredits(3, result));
  for (const credits of [200, 3.1, -1, NaN, 0.15]) assert.throws(() => validateSeparationLeaveCredits(credits, result));
  const depleted = sources(); depleted.balances[0].used = "10";
  assert.equal(separationLeaveAllowance(depleted, "Vacation leave", 2026).convertible, 1);
});
test("unapproved, ambiguous, missing and malformed leave evidence fails closed", () => {
  const unapproved = sources(); unapproved.policies[0].conversionCap = null;
  assert.throws(() => separationLeaveAllowance(unapproved, "Vacation leave", 2026));
  const ambiguous = sources(); ambiguous.policies.push({ ...ambiguous.policies[0], id: 4 });
  assert.throws(() => separationLeaveAllowance(ambiguous, "Vacation leave", 2026));
  const malformed = sources(); malformed.balances[0].opening = "";
  assert.throws(() => separationLeaveAllowance(malformed, "Vacation leave", 2026));
  assert.throws(() => separationLeaveAllowance(sources(), "Vacation leave", 2025));
});
test("invalid reservations cannot increase the amount available for final pay", () => {
  for (const amount of ["", "NaN", "-2"]) {
    const invalid = sources(); invalid.conversions[0].daysConverted = amount;
    assert.throws(() => separationLeaveAllowance(invalid, "Vacation leave", 2026));
  }
});

import { finalPaySourceFingerprint } from "../src/lib/final-pay-source-fingerprint";
test("approval evidence becomes stale when leave balances, policy caps or reservations change", () => {
  const leave = sources();
  const input = {
    employee: { status: "Separating", basicRate: "30000", mwe: false, orgUnitId: null, legalEntityId: null, employmentType: "Regular", startDate: "2024-01-01" },
    payProfile: { id: 1, payBasis: "monthly", rateAmount: "30000", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8", updatedAt: null },
    released: [], historical: [], loans: [], leave,
  };
  const before = JSON.stringify(finalPaySourceFingerprint(input));
  for (const change of [
    (s: SeparationLeaveSources) => { s.balances[0].used = "4"; },
    (s: SeparationLeaveSources) => { s.policies[0].conversionCap = 4; },
    (s: SeparationLeaveSources) => { s.conversions[0].daysConverted = "3"; },
  ]) {
    const changed = sources(); change(changed);
    assert.notEqual(JSON.stringify(finalPaySourceFingerprint({ ...input, leave: changed })), before);
  }
});
