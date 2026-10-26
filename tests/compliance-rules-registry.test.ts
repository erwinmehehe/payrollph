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
test("rule selection rejects impossible or noncanonical payroll dates", () => {
  for (const asOf of [
    "2026-02-30", "2025-02-29", "2026-13-01", "2026-00-01",
    "2026-01-00", "2026-2-28", "2026-10-04T00:00:00Z", "",
  ]) {
    assert.throws(
      () => resolveComplianceRule([rule()], { ruleKey: "PHILHEALTH_PREMIUM", asOf }),
      /valid ISO calendar date/,
      asOf,
    );
  }
  const leap = rule({ effectiveFrom: "2024-02-29", effectiveUntil: "2024-02-29" });
  assert.equal(
    resolveComplianceRule([leap], { ruleKey: "PHILHEALTH_PREMIUM", asOf: "2024-02-29" }).ruleVersion,
    "PHIC-2025",
  );
  assert.throws(
    () => resolveComplianceRule([leap], { ruleKey: "PHILHEALTH_PREMIUM", asOf: "2024-03-01" }),
    /No approved compliance rule/,
  );
});

test("approved registry records must have valid and ordered legal windows", () => {
  const invalidWindows: Array<Partial<ComplianceRuleRecord>> = [
    { effectiveFrom: "2025-02-29" },
    { effectiveFrom: "2026-02-30" },
    { effectiveFrom: "2025-1-01" },
    { effectiveUntil: "2026-13-01" },
    { effectiveUntil: "2026-02-30" },
    { effectiveUntil: "" },
    { effectiveUntil: "2024-12-31" },
  ];
  for (const invalid of invalidWindows) {
    assert.throws(
      () => resolveComplianceRule([rule(invalid)], {
        ruleKey: "PHILHEALTH_PREMIUM", asOf: "2026-10-04",
      }),
      /Invalid compliance rule effective-date window/,
      JSON.stringify(invalid),
    );
  }
});

test("an invalid approved future rule cannot silently let an older version win", () => {
  assert.throws(
    () => resolveComplianceRule([
      rule(),
      rule({ id: 2, ruleVersion: "PHIC-IMPOSSIBLE", effectiveFrom: "2026-02-30" }),
    ], { ruleKey: "PHILHEALTH_PREMIUM", asOf: "2026-02-28" }),
    /Invalid compliance rule effective-date window.*PHIC-IMPOSSIBLE/,
  );
});

test("unapproved and unrelated-region draft windows do not block a valid rule", () => {
  const selected = resolveComplianceRule([
    rule(),
    rule({ id: 2, status: "draft", approvedAt: null, effectiveFrom: "invalid" }),
    rule({ id: 3, region: "NCR", effectiveFrom: "invalid" }),
  ], { ruleKey: "PHILHEALTH_PREMIUM", asOf: "2026-10-04" });
  assert.equal(selected.ruleVersion, "PHIC-2025");
});
