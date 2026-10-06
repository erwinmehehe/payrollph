import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCapabilityEligibility } from "../src/lib/hcm-workforce-eligibility";

test("verified skill and current credential satisfy workforce eligibility", () => {
  const result = evaluateCapabilityEligibility({
    workDate: "2026-10-06",
    skillRequirements: [{ skillId: 1, skillName: "Forklift", minimumProficiency: 3, mandatory: true }],
    employeeSkills: [{ skillId: 1, proficiency: 4, status: "verified", effectiveFrom: "2026-01-01", effectiveUntil: null }],
    credentialRequirements: [{ documentRequirementId: 10, name: "Forklift licence", mandatory: true, blocksWorkforceEligibility: true }],
    credentialCompliance: [{ requirementId: 10, status: "current", expiresAt: "2027-01-01" }],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.status, "eligible");
  assert.deepEqual(result.blockers, []);
});

test("declared or under-level mandatory skill blocks qualified coverage", () => {
  const unverified = evaluateCapabilityEligibility({
    workDate: "2026-10-06",
    skillRequirements: [{ skillId: 1, skillName: "RN triage", minimumProficiency: 4, mandatory: true }],
    employeeSkills: [{ skillId: 1, proficiency: 5, status: "declared", effectiveFrom: "2026-01-01", effectiveUntil: null }],
    credentialRequirements: [],
    credentialCompliance: [],
  });
  assert.equal(unverified.eligible, false);
  assert.match(unverified.blockers[0] ?? "", /not verified/i);

  const underLevel = evaluateCapabilityEligibility({
    workDate: "2026-10-06",
    skillRequirements: [{ skillId: 1, skillName: "RN triage", minimumProficiency: 4, mandatory: true }],
    employeeSkills: [{ skillId: 1, proficiency: 3, status: "verified", effectiveFrom: "2026-01-01", effectiveUntil: null }],
    credentialRequirements: [],
    credentialCompliance: [],
  });
  assert.equal(underLevel.eligible, false);
  assert.match(underLevel.blockers[0] ?? "", /below required level/i);
});

test("expired blocking credential fails but waived credential passes", () => {
  const expired = evaluateCapabilityEligibility({
    workDate: "2026-10-06",
    skillRequirements: [],
    employeeSkills: [],
    credentialRequirements: [{ documentRequirementId: 22, name: "PRC licence", mandatory: true, blocksWorkforceEligibility: true }],
    credentialCompliance: [{ requirementId: 22, status: "expired", expiresAt: "2026-09-30" }],
  });
  assert.equal(expired.eligible, false);
  assert.match(expired.blockers[0] ?? "", /expired/i);

  const waived = evaluateCapabilityEligibility({
    workDate: "2026-10-06",
    skillRequirements: [],
    employeeSkills: [],
    credentialRequirements: [{ documentRequirementId: 22, name: "PRC licence", mandatory: true, blocksWorkforceEligibility: true }],
    credentialCompliance: [{ requirementId: 22, status: "waived", expiresAt: null, waivedAt: "2026-10-01" }],
  });
  assert.equal(waived.eligible, true);
});

test("expiring current credential warns without blocking", () => {
  const result = evaluateCapabilityEligibility({
    workDate: "2026-10-06",
    skillRequirements: [],
    employeeSkills: [],
    credentialRequirements: [{ documentRequirementId: 30, name: "First aid", mandatory: true, blocksWorkforceEligibility: true }],
    credentialCompliance: [{ requirementId: 30, status: "expiring", expiresAt: "2026-10-20" }],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.status, "warning");
  assert.match(result.warnings[0] ?? "", /expiring/i);
});
