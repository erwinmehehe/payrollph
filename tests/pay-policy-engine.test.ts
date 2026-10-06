import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  orderedPayPolicyRules,
  payPolicyTrace,
  resolveApplicablePayPolicies,
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
