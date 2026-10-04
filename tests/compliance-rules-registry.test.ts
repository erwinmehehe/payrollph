import assert from "node:assert/strict";
import test from "node:test";
import {
  complianceRuleTrace,
  resolveComplianceRule,
  type ComplianceRuleRecord,
} from "../src/lib/compliance-rules-registry";

function rule(overrides: Partial<ComplianceRuleRecord> = {}): ComplianceRuleRecord {
  return {
    id: 1,
    ruleKey: "PHILHEALTH_PREMIUM",
    agency: "PhilHealth",
    jurisdiction: "PH",
    region: "ALL",
    ruleVersion: "PHIC-2025",
    effectiveFrom: "2025-01-01",
    effectiveUntil: null,
    sourceDocument: "PhilHealth Circular",
    sourceUrl: "https://example.test/philhealth",
    payload: { rate: 0.05 },
    status: "approved",
    futureEffective: false,
    reviewedBy: "Reviewer",
    approvedBy: "Approver",
    approvedAt: "2025-01-01T00:00:00Z",
    supersedesRuleVersion: null,
    rollbackVersion: null,
    ...overrides,
  };
}

test("approved rule resolves only inside its legal effective window", () => {
  const resolved = resolveComplianceRule([rule()], {
    ruleKey: "PHILHEALTH_PREMIUM",
    asOf: "2026-10-04",
  });
  assert.equal(resolved.ruleVersion, "PHIC-2025");
});

test("future-effective rule is never activated before its effective date", () => {
  assert.throws(
    () => resolveComplianceRule([
      rule({
        ruleVersion: "PHIC-2027",
        effectiveFrom: "2027-01-01",
        futureEffective: true,
      }),
    ], {
      ruleKey: "PHILHEALTH_PREMIUM",
      asOf: "2026-12-31",
    }),
    /No approved compliance rule/,
  );
});

test("draft or unapproved rules cannot drive payroll", () => {
  assert.throws(
    () => resolveComplianceRule([
      rule({ status: "draft", approvedAt: null }),
    ], {
      ruleKey: "PHILHEALTH_PREMIUM",
      asOf: "2026-10-04",
    }),
    /No approved compliance rule/,
  );
});

test("overlapping approved versions fail closed instead of guessing", () => {
  assert.throws(
    () => resolveComplianceRule([
      rule({ ruleVersion: "PHIC-A", effectiveFrom: "2026-01-01" }),
      rule({ id: 2, ruleVersion: "PHIC-B", effectiveFrom: "2026-06-01" }),
    ], {
      ruleKey: "PHILHEALTH_PREMIUM",
      asOf: "2026-10-04",
    }),
    /Ambiguous approved compliance rules.*PHIC-A, PHIC-B/,
  );
});

test("regional rules resolve only within their explicit jurisdiction", () => {
  const ncr = rule({
    ruleKey: "MINIMUM_WAGE_SCREEN",
    agency: "DOLE",
    region: "NCR",
    ruleVersion: "WAGE-NCR-28",
    effectiveFrom: "2026-09-26",
  });
  assert.equal(resolveComplianceRule([ncr], {
    ruleKey: "MINIMUM_WAGE_SCREEN",
    region: "NCR",
    asOf: "2026-10-04",
  }).ruleVersion, "WAGE-NCR-28");

  assert.throws(() => resolveComplianceRule([ncr], {
    ruleKey: "MINIMUM_WAGE_SCREEN",
    region: "VII",
    asOf: "2026-10-04",
  }));
});

test("audit trace persists source, approval and supersession evidence", () => {
  const trace = complianceRuleTrace(rule({
    supersedesRuleVersion: "PHIC-2024",
    rollbackVersion: "PHIC-2024",
  }));
  assert.deepEqual(trace, {
    ruleKey: "PHILHEALTH_PREMIUM",
    agency: "PhilHealth",
    jurisdiction: "PH",
    region: "ALL",
    ruleVersion: "PHIC-2025",
    effectiveFrom: "2025-01-01",
    effectiveUntil: null,
    sourceDocument: "PhilHealth Circular",
    sourceUrl: "https://example.test/philhealth",
    reviewedBy: "Reviewer",
    approvedBy: "Approver",
    approvedAt: "2025-01-01T00:00:00.000Z",
    supersedesRuleVersion: "PHIC-2024",
    rollbackVersion: "PHIC-2024",
  });
});
