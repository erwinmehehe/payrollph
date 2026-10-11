import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HOLIDAY_REST_DAY_PREMIUM_EVENT,
  NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
  OVERTIME_PREMIUM_EVENT,
  orderedPayPolicyRules,
  payPolicyTrace,
  resolveApplicablePayPolicies,
  resolveHolidayRestDayPremium,
  resolveNightDifferentialPremium,
  resolveOvertimePremium,
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
  assert.match(source, /const gross = roundedGrossFromBuckets\(\[[\s\S]*?\bcompanyPremiumPay,[\s\S]*?\]\);/);
  assert.ok(source.includes("companyPremiumExcludedFromSssBase"));
  assert.ok(source.includes("companyPremiumExcludedFromPagIbigBase"));
  assert.ok(source.includes("payPolicyExecution"));
  assert.ok(source.includes("...companyPremiumApplications"));
  assert.ok(source.includes('PAYROLL_RULE_VERSION = "PH-2026.09"'));
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
  assert.match(source, /const gross = roundedGrossFromBuckets\(\[[\s\S]*?\bholidayRestDayPremiumPay,[\s\S]*?\]\);/);
  assert.ok(source.includes("holidayRestDayPremiumExcludedFromSssBase"));
  assert.ok(source.includes("holidayRestDayPremiumExcludedFromPagIbigBase"));
  assert.ok(source.includes('traceInputNumber(prior.trace, "companyPremiumExcludedFromSssBase")'));
  assert.ok(source.includes('traceInputNumber(prior.trace, "holidayRestDayPremiumExcludedFromSssBase")'));
  assert.ok(source.includes("HOLIDAY_REST_DAY_PREMIUM_EVENT"));
  assert.ok(source.includes('PAYROLL_RULE_VERSION = "PH-2026.09"'));
  assert.ok(source.includes('version: "pay-rules-execution-v4"'));
  assert.ok(source.includes('overtime: "separate-overtime-premium-family"'));
  assert.ok(source.includes('nightDifferential: "statutory-only"'));
});

test("cross-midnight fallback blocks holiday/rest-day overlays rather than guessing the calendar allocation", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("configurable holiday/rest-day premium was not executed because cross-midnight payable-time allocation is incomplete"));
  assert.ok(source.includes("holidayRestRuleCouldApply"));
});


test("overtime premiums add above statutory OT without replacing the statutory multiplier", () => {
  const result = resolveOvertimePremium({
    organizationId: 7,
    employeeId: 42,
    orgUnitIds: [9],
    workDate: "2026-10-05",
    minutes: 120,
    hourlyRate: 200,
    holidayType: "ordinary",
    restDay: false,
    statutoryMultiplier: 1.25,
    shiftCode: "DAY",
    worksiteId: 3,
    policies: [policy()],
    rules: [rule({
      eventType: OVERTIME_PREMIUM_EVENT,
      conditions: {},
      outcome: {
        label: "Company OT top-up",
        additionalPremiumPercent: 20,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: false,
      },
    })],
  });

  assert.equal(result.statutoryFloorMode, "additive-only");
  assert.equal(result.authorizationMode, "evidence-only");
  assert.equal(result.nightDifferentialMode, "statutory-only");
  assert.equal(result.amount, 80);
  assert.equal(result.taxableAmount, 80);
  assert.equal(result.sssIncludedAmount, 80);
  assert.equal(result.pagIbigIncludedAmount, 0);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].statutoryMultiplier, 1.25);
  assert.equal(result.applied[0].additionalPremiumPercent, 20);
});

test("overtime rules can target holiday, rest-day, shift, and worksite evidence", () => {
  const targeted = rule({
    eventType: OVERTIME_PREMIUM_EVENT,
    conditions: {
      holidayTypes: ["special"],
      restDay: true,
      shiftCodes: ["NIGHT"],
      worksiteIds: [8],
    },
    outcome: {
      additionalPremiumPercent: 30,
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
    hourlyRate: 200,
    holidayType: "special" as const,
    restDay: true,
    statutoryMultiplier: 1.95,
    policies: [policy()],
    rules: [targeted],
  };

  assert.equal(resolveOvertimePremium({
    ...base,
    shiftCode: "NIGHT",
    worksiteId: 8,
  }).amount, 60);
  assert.equal(resolveOvertimePremium({
    ...base,
    shiftCode: "DAY",
    worksiteId: 8,
  }).amount, 0);
  assert.equal(resolveOvertimePremium({
    ...base,
    holidayType: "ordinary",
    shiftCode: "NIGHT",
    worksiteId: 8,
  }).amount, 0);
});

test("distinct OT rule keys stack while the same key obeys policy precedence", () => {
  const policies = [
    policy({ id: 1, code: "ORG-OT", version: "ORG" }),
    policy({
      id: 2,
      code: "EMP-OT",
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
  const result = resolveOvertimePremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 200,
    holidayType: "ordinary",
    restDay: false,
    statutoryMultiplier: 1.25,
    shiftCode: null,
    worksiteId: null,
    policies,
    rules: [
      rule({
        id: 1,
        policyId: 1,
        ruleKey: "OT-TOPUP",
        eventType: OVERTIME_PREMIUM_EVENT,
        outcome: { ...classification, additionalPremiumPercent: 10 },
      }),
      rule({
        id: 2,
        policyId: 2,
        ruleKey: "OT-TOPUP",
        eventType: OVERTIME_PREMIUM_EVENT,
        outcome: { ...classification, additionalPremiumPercent: 20 },
      }),
      rule({
        id: 3,
        policyId: 1,
        ruleKey: "SECOND-OT-TOPUP",
        eventType: OVERTIME_PREMIUM_EVENT,
        outcome: { ...classification, additionalPremiumPercent: 5 },
      }),
    ],
  });

  assert.equal(result.amount, 50);
  assert.deepEqual(result.applied.map((item) => item.ruleId), [2, 3]);
});

test("overtime premium fails closed when statutory-floor protection is disabled", () => {
  assert.throws(() => resolveOvertimePremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "ordinary",
    restDay: false,
    statutoryMultiplier: 1.25,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: OVERTIME_PREMIUM_EVENT,
      statutoryFloorProtected: false,
      outcome: {
        additionalPremiumPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  }), /statutoryFloorProtected=true/);
});

test("overtime premium requires explicit tax and contribution classifications", () => {
  assert.throws(() => resolveOvertimePremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "ordinary",
    restDay: false,
    statutoryMultiplier: 1.25,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: OVERTIME_PREMIUM_EVENT,
      outcome: { additionalPremiumPercent: 10 },
    })],
  }), /taxable must be explicitly true or false/);
});

test("OT authorization cannot be used to suppress the configurable or statutory OT entitlement path", () => {
  assert.throws(() => resolveOvertimePremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "ordinary",
    restDay: false,
    statutoryMultiplier: 1.25,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [rule({
      eventType: OVERTIME_PREMIUM_EVENT,
      conditions: { authorizationRequired: true },
      outcome: {
        additionalPremiumPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  }), /unsupported field/);
});

test("payroll engine executes and traces OT overlays while preserving statutory OT accounting", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("applyOvertimePremium"));
  assert.match(source, /const gross = roundedGrossFromBuckets\(\[[\s\S]*?\bovertimePremiumPay,[\s\S]*?\]\);/);
  assert.ok(source.includes("overtimePremiumExcludedFromSssBase"));
  assert.ok(source.includes("overtimePremiumExcludedFromPagIbigBase"));
  assert.ok(source.includes('traceInputNumber(prior.trace, "overtimePremiumExcludedFromSssBase")'));
  assert.ok(source.includes("OVERTIME_PREMIUM_EVENT"));
  assert.ok(source.includes('PAYROLL_RULE_VERSION = "PH-2026.09"'));
  assert.ok(source.includes('version: "pay-rules-execution-v4"'));
  assert.ok(source.includes('statutoryEntitlement: "authoritative"'));
  assert.ok(source.includes('authorization: "evidence-only"'));
});

test("cross-midnight fallback blocks OT overlays rather than guessing policy date or day class", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("configurable overtime premium was not executed because cross-midnight payable-time allocation is incomplete"));
  assert.ok(source.includes("overtimeRuleCouldApply"));
});


test("night differential premium adds above the statutory 10% without replacing it", () => {
  const result = resolveNightDifferentialPremium({
    organizationId: 7,
    employeeId: 42,
    orgUnitIds: [9],
    workDate: "2026-10-05",
    minutes: 120,
    hourlyRate: 200,
    holidayType: "ordinary",
    restDay: false,
    overtime: false,
    statutoryMultiplier: 1,
    shiftCode: "NIGHT",
    worksiteId: 3,
    policies: [policy()],
    rules: [rule({
      eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
      conditions: {},
      outcome: {
        label: "CBA night top-up",
        additionalDifferentialPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: false,
      },
    })],
  });

  assert.equal(result.statutoryFloorMode, "additive-only");
  assert.equal(result.statutoryDifferentialPercent, 10);
  assert.equal(result.amount, 40);
  assert.equal(result.taxableAmount, 40);
  assert.equal(result.sssIncludedAmount, 40);
  assert.equal(result.pagIbigIncludedAmount, 0);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].statutoryDifferentialPercent, 10);
  assert.equal(result.applied[0].additionalDifferentialPercent, 10);
});

test("night differential overlay uses the statutory holiday/rest-day/overtime base", () => {
  const result = resolveNightDifferentialPremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-02-17",
    minutes: 60,
    hourlyRate: 200,
    holidayType: "special",
    restDay: true,
    overtime: true,
    statutoryMultiplier: 1.95,
    shiftCode: "GY",
    worksiteId: 8,
    policies: [policy()],
    rules: [rule({
      eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
      conditions: {
        holidayTypes: ["special"],
        restDay: true,
        overtime: true,
        shiftCodes: ["GY"],
        worksiteIds: [8],
      },
      outcome: {
        additionalDifferentialPercent: 15,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  });

  assert.equal(result.amount, 58.5);
  assert.equal(result.applied[0].statutoryMultiplier, 1.95);
  assert.equal(result.applied[0].overtime, true);
});

test("night differential conditions distinguish regular night work from night OT", () => {
  const ruleRow = rule({
    eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
    conditions: { overtime: false },
    outcome: {
      additionalDifferentialPercent: 10,
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
    holidayType: "ordinary" as const,
    restDay: false,
    statutoryMultiplier: 1,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
    rules: [ruleRow],
  };

  assert.equal(resolveNightDifferentialPremium({ ...base, overtime: false }).amount, 10);
  assert.equal(resolveNightDifferentialPremium({ ...base, overtime: true }).amount, 0);
});

test("night differential rule precedence shadows the same rule key while distinct top-ups stack", () => {
  const policies = [
    policy({ id: 1, code: "ORG-NSD", version: "ORG" }),
    policy({
      id: 2,
      code: "EMP-NSD",
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
  const result = resolveNightDifferentialPremium({
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 200,
    holidayType: "ordinary",
    restDay: false,
    overtime: false,
    statutoryMultiplier: 1,
    shiftCode: null,
    worksiteId: null,
    policies,
    rules: [
      rule({
        id: 1,
        policyId: 1,
        ruleKey: "NSD-TOPUP",
        eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
        outcome: { ...classification, additionalDifferentialPercent: 5 },
      }),
      rule({
        id: 2,
        policyId: 2,
        ruleKey: "NSD-TOPUP",
        eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
        outcome: { ...classification, additionalDifferentialPercent: 10 },
      }),
      rule({
        id: 3,
        policyId: 1,
        ruleKey: "SECOND-NSD-TOPUP",
        eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
        outcome: { ...classification, additionalDifferentialPercent: 5 },
      }),
    ],
  });

  assert.equal(result.amount, 30);
  assert.deepEqual(result.applied.map((item) => item.ruleId), [2, 3]);
});

test("night differential premium fails closed without statutory-floor protection or classifications", () => {
  const base = {
    organizationId: 7,
    employeeId: 42,
    workDate: "2026-10-05",
    minutes: 60,
    hourlyRate: 100,
    holidayType: "ordinary" as const,
    restDay: false,
    overtime: false,
    statutoryMultiplier: 1,
    shiftCode: null,
    worksiteId: null,
    policies: [policy()],
  };

  assert.throws(() => resolveNightDifferentialPremium({
    ...base,
    rules: [rule({
      eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
      statutoryFloorProtected: false,
      outcome: {
        additionalDifferentialPercent: 10,
        taxable: true,
        includeInSssBase: true,
        includeInPagIbigBase: true,
      },
    })],
  }), /statutoryFloorProtected=true/);

  assert.throws(() => resolveNightDifferentialPremium({
    ...base,
    rules: [rule({
      eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
      outcome: { additionalDifferentialPercent: 10 },
    })],
  }), /taxable must be explicitly true or false/);
});

test("payroll engine executes NSD overlays and carries classifications through month-end reconciliation", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("applyNightDifferentialPremium"));
  assert.match(source, /const gross = roundedGrossFromBuckets\(\[[\s\S]*?\bnightDifferentialPremiumPay,[\s\S]*?\]\);/);
  assert.ok(source.includes("nightDifferentialPremiumExcludedFromSssBase"));
  assert.ok(source.includes("nightDifferentialPremiumExcludedFromPagIbigBase"));
  assert.ok(source.includes('traceInputNumber(prior.trace, "nightDifferentialPremiumExcludedFromSssBase")'));
  assert.ok(source.includes("NIGHT_DIFFERENTIAL_PREMIUM_EVENT"));
  assert.ok(source.includes('PAYROLL_RULE_VERSION = "PH-2026.09"'));
  assert.ok(source.includes('version: "pay-rules-execution-v4"'));
  assert.ok(source.includes('nightWindow: "statutory-10pm-to-6am"'));
  assert.ok(source.includes('statutoryDifferentialPercent: 10'));
  assert.ok(source.includes("...nightDifferentialPremiumApplications"));
});

test("cross-midnight fallback blocks NSD overlays rather than guessing policy date or premium class", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("configurable night-differential premium was not executed because cross-midnight payable-time allocation is incomplete"));
  assert.ok(source.includes("nightRuleCouldApply"));
});
