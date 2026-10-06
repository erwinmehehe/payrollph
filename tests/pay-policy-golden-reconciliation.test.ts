import assert from "node:assert/strict";
import test from "node:test";
import {
  HOLIDAY_REST_DAY_PREMIUM_EVENT,
  NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
  OVERTIME_PREMIUM_EVENT,
  WORKED_TIME_PREMIUM_EVENT,
  resolveHolidayRestDayPremium,
  resolveNightDifferentialPremium,
  resolveOvertimePremium,
  resolveWorkedTimePremium,
  type PayPolicyHolidayType,
  type PayPolicyRecord,
  type PayPolicyRuleRecord,
} from "../src/lib/pay-policy-engine";

const organizationId = 101;
const employeeId = 202;
const workDate = "2026-10-06";

const policy: PayPolicyRecord = {
  id: 1,
  organizationId,
  code: "GOLDEN-COMPANY-PREMIUM",
  name: "Golden reconciliation policy",
  policyKind: "company",
  version: "2026.10",
  scopeType: "organization",
  scopeOrgUnitId: null,
  scopeEmployeeId: null,
  priority: 100,
  effectiveFrom: "2026-01-01",
  effectiveUntil: null,
  active: true,
  approvedAt: "2026-01-01T00:00:00+08:00",
};

function accountingFlags(index: number) {
  return {
    taxable: index % 2 === 0,
    includeInSssBase: index % 3 !== 0,
    includeInPagIbigBase: index % 4 === 0,
  };
}

function makeRule(input: {
  id: number;
  eventType: string;
  conditions?: Record<string, unknown>;
  outcome: Record<string, unknown>;
}): PayPolicyRuleRecord {
  return {
    id: input.id,
    policyId: policy.id,
    ruleKey: `GOLDEN-${input.eventType.toUpperCase()}-${input.id}`,
    eventType: input.eventType,
    conditions: input.conditions ?? {},
    outcome: input.outcome,
    priority: 100,
    statutoryFloorProtected: true,
    enabled: true,
  };
}

function assertAccounting(
  amount: number,
  result: {
    amount: number;
    taxableAmount: number;
    sssIncludedAmount: number;
    pagIbigIncludedAmount: number;
  },
  flags: ReturnType<typeof accountingFlags>,
) {
  assert.equal(result.amount, amount);
  assert.equal(result.taxableAmount, flags.taxable ? amount : 0);
  assert.equal(result.sssIncludedAmount, flags.includeInSssBase ? amount : 0);
  assert.equal(result.pagIbigIncludedAmount, flags.includeInPagIbigBase ? amount : 0);
}

const workedScenarios = [
  { minutes: 30, hourlyRate: 100, premiumPercent: 5, premiumAmountPerHour: 0, expected: 2.5 },
  { minutes: 60, hourlyRate: 100, premiumPercent: 10, premiumAmountPerHour: 0, expected: 10 },
  { minutes: 90, hourlyRate: 120, premiumPercent: 7.5, premiumAmountPerHour: 0, expected: 13.5 },
  { minutes: 120, hourlyRate: 125.5, premiumPercent: 12, premiumAmountPerHour: 0, expected: 30.12 },
  { minutes: 45, hourlyRate: 200, premiumPercent: 15, premiumAmountPerHour: 5, expected: 26.25 },
  { minutes: 75, hourlyRate: 180, premiumPercent: 8, premiumAmountPerHour: 12.5, expected: 33.63 },
  { minutes: 150, hourlyRate: 160, premiumPercent: 20, premiumAmountPerHour: 0, expected: 80 },
  { minutes: 210, hourlyRate: 99.99, premiumPercent: 25, premiumAmountPerHour: 2.5, expected: 96.24 },
  { minutes: 480, hourlyRate: 150, premiumPercent: 5, premiumAmountPerHour: 10, expected: 140 },
  { minutes: 420, hourlyRate: 175.25, premiumPercent: 12.5, premiumAmountPerHour: 0, expected: 153.34 },
  { minutes: 360, hourlyRate: 220, premiumPercent: 18, premiumAmountPerHour: 7.5, expected: 282.6 },
  { minutes: 300, hourlyRate: 333.33, premiumPercent: 10, premiumAmountPerHour: 20, expected: 266.67 },
  { minutes: 60, hourlyRate: 500, premiumPercent: 3, premiumAmountPerHour: 0, expected: 15 },
  { minutes: 30, hourlyRate: 80, premiumPercent: 50, premiumAmountPerHour: 0, expected: 20 },
  { minutes: 180, hourlyRate: 250, premiumPercent: 0, premiumAmountPerHour: 15, expected: 45 },
  { minutes: 240, hourlyRate: 145.75, premiumPercent: 6.25, premiumAmountPerHour: 4.25, expected: 53.44 },
] as const;

const holidayScenarios = [
  { minutes: 60, hourlyRate: 100, premiumPercent: 10, expected: 10 },
  { minutes: 240, hourlyRate: 100, premiumPercent: 20, expected: 80 },
  { minutes: 480, hourlyRate: 100, premiumPercent: 5, expected: 40 },
  { minutes: 480, hourlyRate: 125.5, premiumPercent: 15, expected: 150.6 },
  { minutes: 420, hourlyRate: 180, premiumPercent: 12.5, expected: 157.5 },
  { minutes: 360, hourlyRate: 200, premiumPercent: 25, expected: 300 },
  { minutes: 300, hourlyRate: 333.33, premiumPercent: 7.5, expected: 125 },
  { minutes: 120, hourlyRate: 500, premiumPercent: 10, expected: 100 },
  { minutes: 90, hourlyRate: 80, premiumPercent: 30, expected: 36 },
  { minutes: 150, hourlyRate: 145.75, premiumPercent: 17.5, expected: 63.77 },
  { minutes: 210, hourlyRate: 220, premiumPercent: 8, expected: 61.6 },
  { minutes: 450, hourlyRate: 175.25, premiumPercent: 22, expected: 289.16 },
  { minutes: 480, hourlyRate: 250, premiumPercent: 3, expected: 60 },
  { minutes: 60, hourlyRate: 99.99, premiumPercent: 50, expected: 50 },
  { minutes: 30, hourlyRate: 160, premiumPercent: 12, expected: 9.6 },
  { minutes: 270, hourlyRate: 190.5, premiumPercent: 6.25, expected: 53.58 },
] as const;

const overtimeScenarios = [
  { minutes: 30, hourlyRate: 100, premiumPercent: 10, expected: 5 },
  { minutes: 60, hourlyRate: 100, premiumPercent: 25, expected: 25 },
  { minutes: 120, hourlyRate: 100, premiumPercent: 15, expected: 30 },
  { minutes: 180, hourlyRate: 125.5, premiumPercent: 20, expected: 75.3 },
  { minutes: 45, hourlyRate: 200, premiumPercent: 30, expected: 45 },
  { minutes: 90, hourlyRate: 180, premiumPercent: 12.5, expected: 33.75 },
  { minutes: 150, hourlyRate: 160, premiumPercent: 8, expected: 32 },
  { minutes: 210, hourlyRate: 99.99, premiumPercent: 22.5, expected: 78.74 },
  { minutes: 240, hourlyRate: 150, premiumPercent: 5, expected: 30 },
  { minutes: 300, hourlyRate: 175.25, premiumPercent: 18, expected: 157.73 },
  { minutes: 360, hourlyRate: 220, premiumPercent: 7.5, expected: 99 },
  { minutes: 420, hourlyRate: 333.33, premiumPercent: 10, expected: 233.33 },
  { minutes: 60, hourlyRate: 500, premiumPercent: 3, expected: 15 },
  { minutes: 30, hourlyRate: 80, premiumPercent: 50, expected: 20 },
  { minutes: 180, hourlyRate: 250, premiumPercent: 6.25, expected: 46.88 },
  { minutes: 75, hourlyRate: 145.75, premiumPercent: 14, expected: 25.51 },
] as const;

const nightScenarios = [
  { minutes: 60, hourlyRate: 100, statutoryMultiplier: 1, premiumPercent: 2, expected: 2 },
  { minutes: 120, hourlyRate: 100, statutoryMultiplier: 1.25, premiumPercent: 5, expected: 12.5 },
  { minutes: 60, hourlyRate: 100, statutoryMultiplier: 1.3, premiumPercent: 10, expected: 13 },
  { minutes: 90, hourlyRate: 125.5, statutoryMultiplier: 1.69, premiumPercent: 5, expected: 15.91 },
  { minutes: 120, hourlyRate: 200, statutoryMultiplier: 2, premiumPercent: 3, expected: 24 },
  { minutes: 180, hourlyRate: 180, statutoryMultiplier: 2.6, premiumPercent: 7.5, expected: 105.3 },
  { minutes: 60, hourlyRate: 160, statutoryMultiplier: 1.5, premiumPercent: 4, expected: 9.6 },
  { minutes: 120, hourlyRate: 99.99, statutoryMultiplier: 1.95, premiumPercent: 6, expected: 23.4 },
  { minutes: 60, hourlyRate: 150, statutoryMultiplier: 3.9, premiumPercent: 2.5, expected: 14.63 },
  { minutes: 30, hourlyRate: 175.25, statutoryMultiplier: 5.07, premiumPercent: 10, expected: 44.43 },
  { minutes: 240, hourlyRate: 220, statutoryMultiplier: 1, premiumPercent: 5, expected: 44 },
  { minutes: 300, hourlyRate: 333.33, statutoryMultiplier: 1.25, premiumPercent: 3, expected: 62.5 },
  { minutes: 360, hourlyRate: 500, statutoryMultiplier: 1.3, premiumPercent: 2, expected: 78 },
  { minutes: 60, hourlyRate: 80, statutoryMultiplier: 1.69, premiumPercent: 12, expected: 16.22 },
  { minutes: 180, hourlyRate: 250, statutoryMultiplier: 2, premiumPercent: 4.5, expected: 67.5 },
  { minutes: 75, hourlyRate: 145.75, statutoryMultiplier: 2.6, premiumPercent: 6.25, expected: 29.61 },
] as const;

test("pay-rule golden reconciliation contains at least 50 fixed independently reviewable cases", () => {
  const total =
    workedScenarios.length
    + holidayScenarios.length
    + overtimeScenarios.length
    + nightScenarios.length;

  assert.equal(total, 64);
  assert.equal(workedScenarios.length, 16);
  assert.equal(holidayScenarios.length, 16);
  assert.equal(overtimeScenarios.length, 16);
  assert.equal(nightScenarios.length, 16);
});

workedScenarios.forEach((scenario, index) => {
  test(`golden worked-time premium ${index + 1}/16`, () => {
    const flags = accountingFlags(index);
    const rule = makeRule({
      id: 1000 + index,
      eventType: WORKED_TIME_PREMIUM_EVENT,
      outcome: {
        label: "Golden worked-time top-up",
        premiumPercent: scenario.premiumPercent,
        premiumAmountPerHour: scenario.premiumAmountPerHour,
        ...flags,
      },
    });

    const result = resolveWorkedTimePremium({
      organizationId,
      employeeId,
      workDate,
      minutes: scenario.minutes,
      hourlyRate: scenario.hourlyRate,
      shiftCode: null,
      worksiteId: null,
      policies: [policy],
      rules: [rule],
    });

    assertAccounting(scenario.expected, result, flags);
    assert.equal(result.statutoryFloorMode, "additive-only");
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0]?.amount, scenario.expected);
  });
});

const premiumHolidayTypes: PayPolicyHolidayType[] = ["special", "regular", "double", "special"];

holidayScenarios.forEach((scenario, index) => {
  test(`golden holiday/rest-day premium ${index + 1}/16`, () => {
    const flags = accountingFlags(index + 16);
    const holidayType = premiumHolidayTypes[index % premiumHolidayTypes.length]!;
    const restDay = index % 2 === 1;
    const statutoryMultiplier =
      holidayType === "double" ? (restDay ? 3.9 : 3)
      : holidayType === "regular" ? (restDay ? 2.6 : 2)
      : (restDay ? 1.5 : 1.3);

    const rule = makeRule({
      id: 2000 + index,
      eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
      conditions: { holidayTypes: [holidayType], restDay },
      outcome: {
        label: "Golden holiday/rest-day top-up",
        additionalPremiumPercent: scenario.premiumPercent,
        ...flags,
      },
    });

    const result = resolveHolidayRestDayPremium({
      organizationId,
      employeeId,
      workDate,
      minutes: scenario.minutes,
      hourlyRate: scenario.hourlyRate,
      holidayType,
      restDay,
      statutoryMultiplier,
      shiftCode: null,
      worksiteId: null,
      policies: [policy],
      rules: [rule],
    });

    assertAccounting(scenario.expected, result, flags);
    assert.equal(result.statutoryFloorMode, "additive-only");
    assert.equal(result.overtimeMode, "statutory-only");
    assert.equal(result.nightDifferentialMode, "statutory-only");
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0]?.statutoryMultiplier, statutoryMultiplier);
  });
});

const overtimeContexts: Array<{
  holidayType: PayPolicyHolidayType;
  restDay: boolean;
  statutoryMultiplier: number;
}> = [
  { holidayType: "ordinary", restDay: false, statutoryMultiplier: 1.25 },
  { holidayType: "special", restDay: false, statutoryMultiplier: 1.69 },
  { holidayType: "special", restDay: true, statutoryMultiplier: 1.95 },
  { holidayType: "regular", restDay: false, statutoryMultiplier: 2.6 },
  { holidayType: "regular", restDay: true, statutoryMultiplier: 3.38 },
  { holidayType: "double", restDay: true, statutoryMultiplier: 5.07 },
];

overtimeScenarios.forEach((scenario, index) => {
  test(`golden overtime premium ${index + 1}/16`, () => {
    const flags = accountingFlags(index + 32);
    const context = overtimeContexts[index % overtimeContexts.length]!;
    const rule = makeRule({
      id: 3000 + index,
      eventType: OVERTIME_PREMIUM_EVENT,
      conditions: {
        holidayTypes: [context.holidayType],
        restDay: context.restDay,
      },
      outcome: {
        label: "Golden overtime top-up",
        additionalPremiumPercent: scenario.premiumPercent,
        ...flags,
      },
    });

    const result = resolveOvertimePremium({
      organizationId,
      employeeId,
      workDate,
      minutes: scenario.minutes,
      hourlyRate: scenario.hourlyRate,
      holidayType: context.holidayType,
      restDay: context.restDay,
      statutoryMultiplier: context.statutoryMultiplier,
      shiftCode: null,
      worksiteId: null,
      policies: [policy],
      rules: [rule],
    });

    assertAccounting(scenario.expected, result, flags);
    assert.equal(result.statutoryFloorMode, "additive-only");
    assert.equal(result.authorizationMode, "evidence-only");
    assert.equal(result.nightDifferentialMode, "statutory-only");
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0]?.statutoryMultiplier, context.statutoryMultiplier);
  });
});

const nightContexts: Array<{
  holidayType: PayPolicyHolidayType;
  restDay: boolean;
  overtime: boolean;
}> = [
  { holidayType: "ordinary", restDay: false, overtime: false },
  { holidayType: "ordinary", restDay: false, overtime: true },
  { holidayType: "special", restDay: false, overtime: false },
  { holidayType: "special", restDay: true, overtime: true },
  { holidayType: "regular", restDay: false, overtime: false },
  { holidayType: "regular", restDay: true, overtime: true },
  { holidayType: "double", restDay: true, overtime: false },
  { holidayType: "double", restDay: true, overtime: true },
];

nightScenarios.forEach((scenario, index) => {
  test(`golden night-differential premium ${index + 1}/16`, () => {
    const flags = accountingFlags(index + 48);
    const context = nightContexts[index % nightContexts.length]!;
    const rule = makeRule({
      id: 4000 + index,
      eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
      conditions: {
        holidayTypes: [context.holidayType],
        restDay: context.restDay,
        overtime: context.overtime,
      },
      outcome: {
        label: "Golden night-differential top-up",
        additionalDifferentialPercent: scenario.premiumPercent,
        ...flags,
      },
    });

    const result = resolveNightDifferentialPremium({
      organizationId,
      employeeId,
      workDate,
      minutes: scenario.minutes,
      hourlyRate: scenario.hourlyRate,
      holidayType: context.holidayType,
      restDay: context.restDay,
      overtime: context.overtime,
      statutoryMultiplier: scenario.statutoryMultiplier,
      shiftCode: null,
      worksiteId: null,
      policies: [policy],
      rules: [rule],
    });

    assertAccounting(scenario.expected, result, flags);
    assert.equal(result.statutoryFloorMode, "additive-only");
    assert.equal(result.statutoryDifferentialPercent, 10);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0]?.statutoryMultiplier, scenario.statutoryMultiplier);
    assert.equal(result.applied[0]?.statutoryDifferentialPercent, 10);
  });
});
