import assert from "node:assert/strict";
import test from "node:test";
import {
  HOLIDAY_REST_DAY_PREMIUM_EVENT, NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
  OVERTIME_PREMIUM_EVENT, WORKED_TIME_PREMIUM_EVENT,
  resolveHolidayRestDayPremium, resolveNightDifferentialPremium,
  resolveOvertimePremium, resolveWorkedTimePremium,
  type PayPolicyRecord, type PayPolicyRuleRecord,
} from "../src/lib/pay-policy-engine";

const policy: PayPolicyRecord = {
  id: 1, organizationId: 7, code: "SYNTHETIC-OVERLAY", name: "Fictional policy",
  policyKind: "company", version: "2026.10", scopeType: "organization",
  scopeOrgUnitId: null, scopeEmployeeId: null, priority: 100,
  effectiveFrom: "2026-01-01", effectiveUntil: null,
  active: true, approvedAt: "2026-01-01T00:00:00Z",
};
const classifications = {
  taxable: true, includeInSssBase: true, includeInPagIbigBase: true,
};
const shared = {
  organizationId: 7, employeeId: 42, workDate: "2026-10-06",
  minutes: 60, hourlyRate: 100, shiftCode: null, worksiteId: null,
  policies: [policy],
};
function premiumRule(eventType: string, rateField: string, value: unknown,
  conditions: Record<string, unknown> = {}): PayPolicyRuleRecord {
  return {
    id: 101, policyId: 1, ruleKey: "SYNTHETIC-RATE", eventType,
    conditions, outcome: { ...classifications, [rateField]: value },
    priority: 100, statutoryFloorProtected: true, enabled: true,
  };
}

const families = [
  {
    name: "worked time", event: WORKED_TIME_PREMIUM_EVENT,
    field: "premiumPercent", conditions: {},
    run: (rule: PayPolicyRuleRecord) => resolveWorkedTimePremium({
      ...shared, rules: [rule],
    }),
  },
  {
    name: "holiday/rest day", event: HOLIDAY_REST_DAY_PREMIUM_EVENT,
    field: "additionalPremiumPercent", conditions: { holidayTypes: ["special"], restDay: true },
    run: (rule: PayPolicyRuleRecord) => resolveHolidayRestDayPremium({
      ...shared, holidayType: "special", restDay: true, statutoryMultiplier: 1.5,
      rules: [rule],
    }),
  },
  {
    name: "overtime", event: OVERTIME_PREMIUM_EVENT,
    field: "additionalPremiumPercent", conditions: {},
    run: (rule: PayPolicyRuleRecord) => resolveOvertimePremium({
      ...shared, holidayType: "ordinary", restDay: false, statutoryMultiplier: 1.25,
      rules: [rule],
    }),
  },
  {
    name: "night differential", event: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
    field: "additionalDifferentialPercent", conditions: {},
    run: (rule: PayPolicyRuleRecord) => resolveNightDifferentialPremium({
      ...shared, holidayType: "ordinary", restDay: false,
      overtime: false, statutoryMultiplier: 1, rules: [rule],
    }),
  },
];

test("all premium families reject boolean, array, object and non-decimal rate evidence", () => {
  const invalid = [
    true, false, [10], [], { rate: 10 }, "0x10", "1e1",
    "", " ", " 10 ", "NaN", Infinity, Number.NaN, -1,
  ];
  for (const family of families) {
    for (const value of invalid) {
      const rule = premiumRule(family.event, family.field, value, family.conditions);
      assert.throws(() => family.run(rule),
        /must be (a finite numeric rate between|between) 0 and/,
        family.name + ": " + JSON.stringify(value));
    }
  }
});

test("canonical numeric rates and decimal-text legacy rates still compute every premium family", () => {
  for (const family of families) {
    for (const value of [10, "10", "10.5", ".5", "10."]) {
      const rule = premiumRule(family.event, family.field, value, family.conditions);
      const result = family.run(rule);
      assert.equal(result.applied.length, 1,
        family.name + " " + JSON.stringify(value));
      assert.ok(result.amount > 0);
      assert.equal(result.statutoryFloorMode, "additive-only");
    }
  }
});
