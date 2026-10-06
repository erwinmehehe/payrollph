import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HOLIDAY_REST_DAY_PREMIUM_EVENT,
  orderedPayPolicyRules,
  payPolicyTrace,
  resolveApplicablePayPolicies,
  resolveHolidayRestDayPremium,
  resolveWorkedTimePremium,
  WORKED_TIME_PREMIUM_EVENT,
  type PayPolicyRecord,
  type PayPolicyRuleRecord,
} from "../src/lib/pay-policy-engine";

function policy(overrides: Partial<PayPolicyRecord> = {}): PayPolicyRecord {
  return {
    id: 1,
    organizationId: 7,
    code: "COMPANY-BASE",
    name: "Company base policy",
    policyKind: "company",
    version: "2026.1",
    scopeType: "organization",
    scopeOrgUnitId: null,
    scopeEmployeeId: null,
    priority: 100,
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    active: true,
    approvedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function rule(overrides: Partial<PayPolicyRuleRecord> = {}): PayPolicyRuleRecord {
  return {
    id: 1,
    policyId: 1,
    ruleKey: "NIGHT_PREMIUM",
    eventType: "night_work",
    conditions: {},
    outcome: { premiumPercent: 10 },
    priority: 100,
    statutoryFloorProtected: true,
    enabled: true,
    ...overrides,
  };
}

test("employee policy outranks org-unit and organization policy", () => {
  const policies = resolveApplicablePayPolicies({
    organizationId: 7,
    employeeId: 42,
    orgUnitIds: [9],
    asOf: "2026-10-05",
    policies: [
      policy({ id: 1 }),
      policy({ id: 2, code: "PLANT-A", scopeType: "org_unit", scopeOrgUnitId: 9, priority: 200 }),
      policy({ id: 3, code: "EMP-42", scopeType: "employee", scopeEmployeeId: 42, priority: 1 }),
    ],
  });

  assert.deepEqual(policies.map((item) => item.id), [3, 2, 1]);
});

test("future, inactive, unapproved and unrelated policies do not apply", () => {
  const policies = resolveApplicablePayPolicies({
    organizationId: 7,
    employeeId: 42,
    orgUnitIds: [9],
    asOf: "2026-10-05",
    policies: [
      policy({ id: 1 }),
      policy({ id: 2, code: "FUTURE", effectiveFrom: "2027-01-01" }),
      policy({ id: 3, code: "INACTIVE", active: false }),
      policy({ id: 4, code: "DRAFT", approvedAt: null }),
      policy({ id: 5, code: "OTHER-EMP", scopeType: "employee", scopeEmployeeId: 77 }),
      policy({ id: 6, code: "OTHER-ORG", organizationId: 99 }),
    ],
  });

  assert.deepEqual(policies.map((item) => item.id), [1]);
});

test("same policy code may override across hierarchy layers", () => {
  const policies = resolveApplicablePayPolicies({
    organizationId: 7,
    employeeId: 42,
    asOf: "2026-10-05",
    policies: [
      policy({ id: 1, code: "OVERTIME", version: "COMPANY" }),
      policy({ id: 2, code: "OVERTIME", version: "EMPLOYEE", scopeType: "employee", scopeEmployeeId: 42 }),
    ],
  });

  assert.deepEqual(policies.map((item) => item.id), [2, 1]);
});

test("overlapping approved versions in the same policy scope fail closed", () => {
  assert.throws(() => resolveApplicablePayPolicies({
    organizationId: 7,
    employeeId: 42,
    asOf: "2026-10-05",
    policies: [
      policy({ id: 1, code: "CBA-A", version: "1" }),
      policy({ id: 2, code: "CBA-A", version: "2", effectiveFrom: "2026-06-01" }),
    ],
  }), /Ambiguous effective pay policy versions/);
});

test("multiple applicable org-unit versions of the same policy code fail closed without scope-depth evidence", () => {
  assert.throws(() => resolveApplicablePayPolicies({
    organizationId: 7,
    employeeId: 42,
    orgUnitIds: [9, 10],
    asOf: "2026-10-05",
    policies: [
      policy({ id: 1, code: "PLANT-RULE", version: "A", scopeType: "org_unit", scopeOrgUnitId: 9 }),
      policy({ id: 2, code: "PLANT-RULE", version: "B", scopeType: "org_unit", scopeOrgUnitId: 10 }),
    ],
  }), /Ambiguous effective pay policy versions/);
});

test("rule ordering follows policy precedence then rule priority", () => {
  const policies = [
    policy({ id: 3, code: "EMP", scopeType: "employee", scopeEmployeeId: 42 }),
    policy({ id: 1 }),
  ];
  const rules = orderedPayPolicyRules({
    policies,
    rules: [
      rule({ id: 1, policyId: 1, priority: 999 }),
      rule({ id: 2, policyId: 3, priority: 10 }),
      rule({ id: 3, policyId: 3, priority: 20 }),
      rule({ id: 4, policyId: 3, enabled: false }),
    ],
  });

  assert.deepEqual(rules.map((item) => item.id), [3, 2, 1]);
});

test("policy trace preserves effective-date and scope evidence", () => {
  const trace = payPolicyTrace([
    policy({
      id: 9,
      code: "CBA-PLANT-1",
      policyKind: "cba",
      version: "2026-A",
      scopeType: "org_unit",
      scopeOrgUnitId: 12,
      priority: 250,
      effectiveUntil: "2026-12-31",
    }),
  ]);

  assert.deepEqual(trace, [{
    policyId: 9,
    code: "CBA-PLANT-1",
    name: "Company base policy",
    policyKind: "cba",
    version: "2026-A",
    scopeType: "org_unit",
    scopeOrgUnitId: 12,
    scopeEmployeeId: null,
    priority: 250,
    effectiveFrom: "2026-01-01",
    effectiveUntil: "2026-12-31",
  }]);
});

test("production compatibility schema includes pay policy tables and guards", () => {
  const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  assert.ok(source.includes("CREATE TABLE IF NOT EXISTS pay_policies"));
  assert.ok(source.includes("CREATE TABLE IF NOT EXISTS pay_policy_rules"));
  assert.ok(source.includes("pay_policies_dates_check"));
  assert.ok(source.includes("pay_policies_scope_check"));
});


test("worked-time premium is additive above statutory pay and carries explicit classifications", () => {
  const result = resolveWorkedTimePremium({
    organizationId: 7,
    employeeId: 42,
    orgUnitIds: [9],
    workDate: "2026-10-05",
    minutes: 120,
    hourlyRate: 100,
    shiftCode: "GRAVEYARD",
    worksiteId: 3,
    policies: [policy()],
    rules: [rule({
      eventType: WORKED_TIME_PREMIUM_EVENT,
      conditions: {},
      outcome: {
        label: "Company shift premium",
        premiumPercent: 10,
        premiumAmountPerHour: 5,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: false,
      },
    })],
  });

  assert.equal(result.statutoryFloorMode, "additive-only");
  assert.equal(result.amount, 30);
  assert.equal(result.taxableAmount, 30);
  assert.equal(result.sssIncludedAmount, 30);
  assert.equal(result.pagIbigIncludedAmount, 0);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].policyVersion, "2026.1");
  assert.equal(result.applied[0].ruleId, 1);
});

test("higher-precedence matching rule key shadows the organization rule", () => {
  const policies = [
    policy({ id: 1, code: "SHIFT-PREM", version: "ORG" }),
    policy({
      id: 2,
      code: "SHIFT-PREM-EMP",
      version: "EMP",
      scopeType: "employee",
      scopeEmployeeId: 42,
      priority: 1,
    }),
  ];
  const commonOutcome = {
    label: "Shift premium",
    taxable: true,
    includeInSssBase: true,
    includeInPagIbigBase: true,
  };
  const result = resolveWorkedTimePremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    shiftCode: "NIGHT",
    worksiteId: null,
    policies,
    rules: [
      rule({
        id: 1,
        policyId: 1,
        ruleKey: "SHIFT-ADD",
        eventType: WORKED_TIME_PREMIUM_EVENT,
        outcome: { ...commonOutcome, premiumPercent: 10 },
      }),
      rule({
        id: 2,
        policyId: 2,
        ruleKey: "SHIFT-ADD",
        eventType: WORKED_TIME_PREMIUM_EVENT,
        outcome: { ...commonOutcome, premiumPercent: 20 },
      }),
    ],
  });

  assert.equal(result.amount, 20);
  assert.deepEqual(result.applied.map((item) => item.ruleId), [2]);
});

test("worked-time premium conditions can target shift and worksite without touching legal premium classes", () => {
  const matchingRule = rule({
    eventType: WORKED_TIME_PREMIUM_EVENT,
    conditions: { shiftCodes: ["GY"], worksiteIds: [8] },
    outcome: {
      premiumAmountPerHour: 25,
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: true,
    },
  });
  const base = {
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    policies: [policy()],
    rules: [matchingRule],
  };

  assert.equal(resolveWorkedTimePremium({
    ...base,
    shiftCode: "gy",
    worksiteId: 8,
  }).amount, 25);
  assert.equal(resolveWorkedTimePremium({
    ...base,
    shiftCode: "DAY",
    worksiteId: 8,
  }).amount, 0);
  assert.equal(resolveWorkedTimePremium({
    ...base,
    shiftCode: "GY",
    worksiteId: 9,
  }).amount, 0);
});

test("worked-time premium fails closed if statutory-floor protection is disabled", () => {
  assert.throws(() => resolveWorkedTimePremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: WORKED_TIME_PREMIUM_EVENT,
      statutoryFloorProtected: false,
      outcome: {
        premiumPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  }), /statutoryFloorProtected=true/);
});

test("worked-time premium requires explicit tax and contribution classifications", () => {
  assert.throws(() => resolveWorkedTimePremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: WORKED_TIME_PREMIUM_EVENT,
      outcome: { premiumPercent: 10 },
    })],
  }), /taxable must be explicitly true or false/);
});

test("worked-time premium rejects unsupported condition fields instead of guessing", () => {
  assert.throws(() => resolveWorkedTimePremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: WORKED_TIME_PREMIUM_EVENT,
      conditions: { overtime: true },
      outcome: {
        premiumPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  }), /unsupported field/);
});

test("payroll engine loads, applies and traces the migrated company-premium family", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("from(payPolicies)"));
  assert.ok(source.includes("lte(payPolicies.effectiveFrom, workforcePricingWindowEnd)"));
  assert.ok(source.includes("from(payPolicyRules)"));
  assert.ok(source.includes("applyWorkedTimePremium"));
  assert.ok(source.includes("+ companyPremiumPay"));
  assert.ok(source.includes("companyPremiumExcludedFromSssBase"));
  assert.ok(source.includes("companyPremiumExcludedFromPagIbigBase"));
  assert.ok(source.includes("payPolicyExecution"));
  assert.ok(source.includes("...companyPremiumApplications"));
  assert.ok(source.includes('PAYROLL_RULE_VERSION = "PH-2026.07"'));
});

test("cross-midnight fallback blocks release rather than guessing effective-dated company premiums", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("configurable company premium was not executed because cross-midnight payable-time allocation is incomplete"));
  assert.ok(source.includes("premiumRuleCouldApply"));
});


test("targeted worked-time premiums require resolvable shift and worksite evidence", () => {
  const targeted = rule({
    eventType: WORKED_TIME_PREMIUM_EVENT,
    conditions: { shiftCodes: ["NIGHT"], worksiteIds: [8] },
    outcome: {
      premiumPercent: 10,
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: true,
    },
  });
  const base = {
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    policies: [policy()],
    rules: [targeted],
  };

  assert.throws(() => resolveWorkedTimePremium({
    ...base,
    shiftCode: null,
    worksiteId: 8,
  }), /could not resolve a shift code/);
  assert.throws(() => resolveWorkedTimePremium({
    ...base,
    shiftCode: "NIGHT",
    worksiteId: null,
  }), /could not resolve a worksite/);
});


test("holiday/rest-day premiums add above the statutory multiplier without replacing it", () => {
  const result = resolveHolidayRestDayPremium({
    organizationId: 7,
    employeeId: 42,
    orgUnitIds: [9],
    workDate: "2026-02-17",
    minutes: 480,
    hourlyRate: 200,
    holidayType: "special",
    restDay: true,
    statutoryMultiplier: 1.5,
    shiftCode: "DAY",
    worksiteId: 3,
    policies: [policy()],
    rules: [rule({
      eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
      conditions: { holidayTypes: ["special"], restDay: true },
      outcome: {
        label: "CBA special-rest top-up",
        additionalPremiumPercent: 20,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: false,
      },
    })],
  });

  assert.equal(result.statutoryFloorMode, "additive-only");
  assert.equal(result.overtimeMode, "statutory-only");
  assert.equal(result.nightDifferentialMode, "statutory-only");
  assert.equal(result.amount, 320);
  assert.equal(result.taxableAmount, 320);
  assert.equal(result.sssIncludedAmount, 320);
  assert.equal(result.pagIbigIncludedAmount, 0);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].statutoryMultiplier, 1.5);
  assert.equal(result.applied[0].additionalPremiumPercent, 20);
});

test("distinct holiday/rest-day rule keys stack while the same key obeys policy precedence", () => {
  const policies = [
    policy({ id: 1, code: "ORG-DAY", version: "ORG" }),
    policy({
      id: 2,
      code: "EMP-DAY",
      version: "EMP",
      scopeType: "employee",
      scopeEmployeeId: 42,
      priority: 1,
    }),
  ];
  const classification = {
    taxable: true,
    includeInSssBase: true,
    includeInPagIbigBase: true,
  };
  const result = resolveHolidayRestDayPremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-02-17",
    minutes: 60,
    hourlyRate: 200,
    holidayType: "special",
    restDay: true,
    statutoryMultiplier: 1.5,
    shiftCode: null,
    worksiteId: null,
    policies,
    rules: [
      rule({
        id: 1,
        policyId: 1,
        ruleKey: "SPECIAL-TOPUP",
        eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
        conditions: { holidayTypes: ["special"] },
        outcome: { ...classification, additionalPremiumPercent: 10 },
      }),
      rule({
        id: 2,
        policyId: 2,
        ruleKey: "SPECIAL-TOPUP",
        eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
        conditions: { holidayTypes: ["special"] },
        outcome: { ...classification, additionalPremiumPercent: 20 },
      }),
      rule({
        id: 3,
        policyId: 1,
        ruleKey: "REST-TOPUP",
        eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
        conditions: { restDay: true },
        outcome: { ...classification, additionalPremiumPercent: 5 },
      }),
    ],
  });

  assert.equal(result.amount, 50);
  assert.deepEqual(result.applied.map((item) => item.ruleId), [2, 3]);
});

test("holiday/rest-day family rejects ordinary non-rest-day rules", () => {
  assert.throws(() => resolveHolidayRestDayPremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "ordinary",
    restDay: false,
    statutoryMultiplier: 1,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
      conditions: { holidayTypes: ["ordinary"] },
      outcome: {
        additionalPremiumPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  }), /ordinary non-rest-day premiums belong in worked_time_premium/);
});

test("holiday/rest-day family fails closed when statutory-floor protection is disabled", () => {
  assert.throws(() => resolveHolidayRestDayPremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-12-25",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "regular",
    restDay: false,
    statutoryMultiplier: 2,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
      statutoryFloorProtected: false,
      conditions: { holidayTypes: ["regular"] },
      outcome: {
        additionalPremiumPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  }), /statutoryFloorProtected=true/);
});

test("holiday/rest-day family requires explicit tax and contribution classifications", () => {
  assert.throws(() => resolveHolidayRestDayPremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-12-25",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "regular",
    restDay: false,
    statutoryMultiplier: 2,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
      conditions: { holidayTypes: ["regular"] },
      outcome: { additionalPremiumPercent: 10 },
    })],
  }), /taxable must be explicitly true or false/);
});

test("holiday/rest-day targeting fails closed when required shift or worksite evidence is missing", () => {
  const targeted = rule({
    eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
    conditions: {
      holidayTypes: ["special"],
      shiftCodes: ["NIGHT"],
      worksiteIds: [8],
    },
    outcome: {
      additionalPremiumPercent: 10,
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: true,
    },
  });
  const base = {
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-02-17",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "special" as const,
    restDay: false,
    statutoryMultiplier: 1.3,
    policies: [policy()],
    rules: [targeted],
  };

  assert.throws(() => resolveHolidayRestDayPremium({
    ...base,
    shiftCode: null,
    worksiteId: 8,
  }), /could not resolve a shift code/);
  assert.throws(() => resolveHolidayRestDayPremium({
    ...base,
    shiftCode: "NIGHT",
    worksiteId: null,
  }), /could not resolve a worksite/);
});

test("holiday/rest-day family rejects overtime conditions so OT remains independently migrated", () => {
  assert.throws(() => resolveHolidayRestDayPremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-12-25",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "regular",
    restDay: false,
    statutoryMultiplier: 2,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
      conditions: { holidayTypes: ["regular"], overtime: true },
      outcome: {
        additionalPremiumPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  }), /unsupported field/);
});

test("payroll engine traces the holiday/rest-day family and preserves month-end premium exclusions", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("applyHolidayRestDayPremium"));
  assert.ok(source.includes("+ holidayRestDayPremiumPay"));
  assert.ok(source.includes("holidayRestDayPremiumExcludedFromSssBase"));
  assert.ok(source.includes("holidayRestDayPremiumExcludedFromPagIbigBase"));
  assert.ok(source.includes('traceInputNumber(prior.trace, "companyPremiumExcludedFromSssBase")'));
  assert.ok(source.includes('traceInputNumber(prior.trace, "holidayRestDayPremiumExcludedFromSssBase")'));
  assert.ok(source.includes("HOLIDAY_REST_DAY_PREMIUM_EVENT"));
  assert.ok(source.includes('PAYROLL_RULE_VERSION = "PH-2026.07"'));
  assert.ok(source.includes('version: "pay-rules-execution-v2"'));
  assert.ok(source.includes('overtime: "statutory-only"'));
  assert.ok(source.includes('nightDifferential: "statutory-only"'));
});

test("cross-midnight fallback blocks holiday/rest-day overlays rather than guessing the calendar allocation", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("configurable holiday/rest-day premium was not executed because cross-midnight payable-time allocation is incomplete"));
  assert.ok(source.includes("holidayRestRuleCouldApply"));
});
