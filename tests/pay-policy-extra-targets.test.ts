import assert from "node:assert/strict";
import test from "node:test";
import { payRuleMatchesVerifiedTargets, selectAdditivePremiumRateTier } from "../src/lib/pay-policy-extra-targets";
import { resolveWorkedTimePremium, type PayPolicyRecord, type PayPolicyRuleRecord } from "../src/lib/pay-policy-engine";

const policy: PayPolicyRecord = {
  id: 1, organizationId: 7, code: "CLIENT-NIGHT", name: "Client night supplement",
  policyKind: "company", version: "v1", scopeType: "organization",
  scopeOrgUnitId: null, scopeEmployeeId: null, priority: 100,
  effectiveFrom: "2026-01-01", effectiveUntil: null, active: true, approvedAt: "2026-01-01",
};
const classification = {
  taxable: true, includeInSssBase: true, includeInPagIbigBase: true,
};
const rule = (conditions: unknown, outcome: unknown): PayPolicyRuleRecord => ({
  id: 2, policyId: 1, ruleKey: "CLIENT-NIGHT", eventType: "worked_time_premium",
  conditions, outcome, priority: 100, statutoryFloorProtected: true, enabled: true,
});
const context = (r: PayPolicyRuleRecord, extra = {}) => ({
  organizationId: 7, employeeId: 42, workDate: "2026-10-05",
  minutes: 60, hourlyRate: 100, shiftCode: "NIGHT", worksiteId: 11,
  policies: [policy], rules: [r], ...extra,
});
test("four explicit selectors match normalized own context, never invent missing evidence", () => {
  const conditions = {
    locationCodes: [" Ncr "], clientCodes: ["client-a"],
    skillCodes: ["sql"], languageCodes: ["en"],
  };
  const evidence = { locationCode: "NCR", clientCode: "CLIENT-A",
    skillCode: "SQL", languageCode: "EN" };
  assert.equal(payRuleMatchesVerifiedTargets(conditions, evidence, "R1"), true);
  assert.equal(payRuleMatchesVerifiedTargets(conditions, { ...evidence, skillCode: "QA" }, "R1"), false);
  assert.throws(() => payRuleMatchesVerifiedTargets(conditions, { ...evidence, languageCode: null }, "R1"),
    /verified languageCode evidence/);
});
test("conditional worked-time premiums consume explicit evidence and preserve rule trace", () => {
  const r = rule({ clientCodes: ["CLIENT-A"], languageCodes: ["EN"] },
    { ...classification, premiumPercent: 10 });
  const result = resolveWorkedTimePremium(context(r, { clientCode: "CLIENT-A", languageCode: "EN" }));
  assert.equal(result.amount, 10);
  assert.equal(result.applied[0]?.clientCode, "CLIENT-A");
  assert.equal(result.applied[0]?.languageCode, "EN");
  assert.equal(resolveWorkedTimePremium(context(r, { clientCode: "OTHER", languageCode: "EN" })).amount, 0);
  assert.throws(() => resolveWorkedTimePremium(context(r)), /verified clientCode evidence/);
});
test("approved effective rate table uses one deterministic non-marginal minute tier", () => {
  const rateTable = [
    { minMinutes: 0, maxMinutes: 60, premiumPercent: 5 },
    { minMinutes: 60, premiumAmountPerHour: 25 },
  ];
  const r = rule({}, { ...classification, rateTable });
  const sixty = resolveWorkedTimePremium(context(r));
  assert.equal(sixty.amount, 25);
  assert.equal(sixty.applied[0]?.rateTableTier?.minMinutes, 60);
  assert.equal(resolveWorkedTimePremium(context(r, { minutes: 30 })).amount, 2.5);
  assert.equal(resolveWorkedTimePremium(context(r, { minutes: 0 })).amount, 0);
});
test("duplicate, overlapping, NaN, invalid and invented selectors cannot silently pay", () => {
  for (const invalid of [
    { clientCodes: [] }, { clientCodes: ["A", "a"] },
    { languageCodes: [42] }, { locationCodes: ["../../bad"] },
  ]) {
    assert.throws(() => payRuleMatchesVerifiedTargets(invalid, {
      clientCode: "A", languageCode: "EN", locationCode: "NCR",
    }, "R1"));
  }
  for (const tiers of [
    [{ minMinutes: 0, premiumPercent: 5 }, { minMinutes: 20, premiumPercent: 8 }],
    [{ minMinutes: 0, maxMinutes: 0, premiumPercent: 5 }],
    [{ minMinutes: 0, premiumPercent: Number.NaN }],
    [{ minMinutes: 0, premiumPercent: -5 }],
    [{ minMinutes: 0, premiumPercent: 5, unknownField: "x" }],
  ]) assert.throws(() => selectAdditivePremiumRateTier(tiers, 60, "R1"));
  assert.throws(() => selectAdditivePremiumRateTier([], 60, "R1"));
  assert.throws(() => selectAdditivePremiumRateTier([
    { minMinutes: 0, premiumPercent: 5 },
  ], Number.NaN, "R1"));
  const invalidMixed = rule({}, { ...classification, rateTable: [
    { minMinutes: 0, premiumPercent: 5 },
  ], premiumPercent: 10 });
  assert.throws(() => resolveWorkedTimePremium(context(invalidMixed)), /cannot mix/);
});
