import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isSalaryCorrectionRequestObject, positiveSalaryRateCents, previewHistoricalSalaryRate,
  projectSalaryCorrectionEvidence, validSalaryCorrectionDate,
} from "../src/lib/hcm-salary-correction-preview";

test("PH salary correction dates reject invalid or impossible dates", () => {
  assert.equal(validSalaryCorrectionDate("2026-02-28"), true);
  assert.equal(validSalaryCorrectionDate("2026-02-29"), false);
  assert.equal(validSalaryCorrectionDate("2026-13-01"), false);
  assert.equal(validSalaryCorrectionDate("2026-01-01T00:00:00Z"), false);
});

test("money validation uses cents without decimal rounding or exponent coercion", () => {
  assert.equal(positiveSalaryRateCents("12500.25"), BigInt(1250025));
  assert.throws(() => positiveSalaryRateCents("12500.251"));
  assert.throws(() => positiveSalaryRateCents("1e5"));
  assert.throws(() => positiveSalaryRateCents(-10));
  assert.throws(() => positiveSalaryRateCents("0"));
  assert.throws(() => positiveSalaryRateCents("100000000.01"));
});

test("historical revision-backed comparison handles a decrease without creating payable amounts", () => {
  const preview = previewHistoricalSalaryRate({
    effectiveDate: "2026-09-15",
    proposedPayBasis: "monthly", proposedRateAmount: "22000.00",
    currentPayBasis: "monthly", currentRateAmount: "28000.00",
    revisions: [
      { id: 2, effectiveDate: "2026-10-01", previousPayBasis: "monthly", previousRateAmount: "25000.00", newPayBasis: "monthly", newRateAmount: "28000.00" },
      { id: 1, effectiveDate: "2026-09-01", previousPayBasis: "monthly", previousRateAmount: "20000.00", newPayBasis: "monthly", newRateAmount: "25000.00" },
    ],
    historyCapped: false,
  });
  assert.equal(preview.before?.rateAmount, "25000.00");
  assert.equal(preview.rateDeltaPerBasisUnit, "-3000.00");
  assert.equal(preview.payrollAmountDelta, null);
  assert.equal(preview.requiresIndependentPayrollRecalculation, true);
});

test("incomplete revision chain or changed basis does not invent a delta", () => {
  const base = {
    effectiveDate: "2026-01-15", proposedPayBasis: "hourly", proposedRateAmount: "150.00",
    currentPayBasis: "monthly", currentRateAmount: "22000.00",
    revisions: [
      { id: 9, effectiveDate: "2026-07-01", previousPayBasis: "monthly", previousRateAmount: "21000.00", newPayBasis: "monthly", newRateAmount: "22000.00" },
    ],
  };
  const unknown = previewHistoricalSalaryRate({ ...base, historyCapped: true });
  assert.equal(unknown.before, null);
  assert.equal(unknown.rateDeltaPerBasisUnit, null);
  assert.equal(unknown.evidence, "incomplete_history");
  const otherBasis = previewHistoricalSalaryRate({ ...base, historyCapped: false });
  assert.equal(otherBasis.rateDeltaPerBasisUnit, null);
  assert.equal(otherBasis.evidence, "revision_prior_baseline");
  const noHistory = previewHistoricalSalaryRate({ ...base, revisions: [], historyCapped: false });
  assert.equal(noHistory.evidence, "current_profile_unverified");
  assert.equal(noHistory.rateDeltaPerBasisUnit, null);
});

test("API is default-off, scoped, and incapable of applying payroll changes", () => {
  const source = readFileSync("src/app/api/hcm/salary-corrections/preview/route.ts", "utf8");
  assert.match(source, /HCM_SALARY_CORRECTION_PREVIEW_ENABLED !== "true"/);
  assert.match(source, /enforceSameOriginMutation/);
  assert.match(source, /assertOrganizationRole/);
  assert.match(source, /PEOPLE_PAYROLL_ROLES/);
  assert.match(source, /companyWide/);
  assert.match(source, /requireSensitiveActionMfa/);
  assert.match(source, /eq\(employees.organizationId, organizationId\)/);
  assert.match(source, /employee.legalEntityId !== legalEntityId/);
  assert.match(source, /HCM_SALARY_CORRECTION_STALE/);
  assert.match(source, /Cache-Control": "private, no-store"/);
  assert.ok(!source.includes("db.insert("));
  assert.ok(!source.includes("db.update("));
  assert.ok(!source.includes("db.delete("));
  assert.ok(!source.includes("db.transaction("));
});

test("salary preview rejects non-object JSON without dereferencing null", () => {
  for (const value of [null, undefined, [], [1], true, false, 1, "{}", "null"]) {
    assert.equal(isSalaryCorrectionRequestObject(value), false);
  }
  assert.equal(isSalaryCorrectionRequestObject({}), true);
  assert.equal(isSalaryCorrectionRequestObject({ organizationId: 1 }), true);
  const source = readFileSync("src/app/api/hcm/salary-corrections/preview/route.ts", "utf8");
  assert.match(source, /request\.json\(\)\.catch\(\(\) => null\)/);
  const guard = source.indexOf("if (!isSalaryCorrectionRequestObject(payload))");
  assert.ok(guard >= 0 && guard < source.indexOf("Number(body.organizationId)"));
  assert.match(source, /A JSON object is required[\s\S]*?status: 400/);
});

test("client evidence allowlist excludes raw rates and unexpected source fields", () => {
  const revisions = [{
    id: 2, effectiveDate: "2026-09-01", previousPayBasis: "monthly",
    previousRateAmount: "20000.00", newPayBasis: "monthly", newRateAmount: "25000.00",
    bankAccount: "SYNTHETIC-BANK-DO-NOT-EXPOSE", notes: "SYNTHETIC-HR-NOTE",
  }];
  const calculated = previewHistoricalSalaryRate({
    effectiveDate: "2026-09-15", proposedPayBasis: "monthly", proposedRateAmount: "22000.00",
    currentPayBasis: "monthly", currentRateAmount: "25000.00", revisions, historyCapped: false,
  });
  const assessment = {
    ...calculated,
    before: { ...calculated.before!, notes: "SYNTHETIC-BEFORE-NOTE" },
    proposed: { ...calculated.proposed, bankAccount: "SYNTHETIC-PROPOSED-BANK" },
    employeeName: "SYNTHETIC-EMPLOYEE-NAME",
  };
  const original = JSON.stringify({ assessment, revisions });
  const projected = projectSalaryCorrectionEvidence(assessment, revisions);
  assert.deepEqual(projected, {
    assessment: {
      effectiveDate: "2026-09-15", before: { payBasis: "monthly" },
      proposed: { payBasis: "monthly" }, rateDeltaPerBasisUnit: "-3000.00",
      evidence: "revision_as_of_date", payrollAmountDelta: null,
      requiresIndependentPayrollRecalculation: true,
    },
    recentRevisions: [{ id: 2, effectiveDate: "2026-09-01", previousPayBasis: "monthly", newPayBasis: "monthly" }],
  });
  assert.doesNotMatch(JSON.stringify(projected), /rateAmount|previousRateAmount|newRateAmount|20000\.00|25000\.00|22000\.00|SYNTHETIC-/);
  assert.equal(JSON.stringify({ assessment, revisions }), original, "projection must not mutate calculation evidence");
});

test("redaction preserves unknown evidence and never invents a payable amount", () => {
  for (const historyCapped of [false, true]) {
    const assessment = previewHistoricalSalaryRate({
      effectiveDate: "2026-01-15", proposedPayBasis: "hourly", proposedRateAmount: "150.00",
      currentPayBasis: "monthly", currentRateAmount: "22000.00", revisions: [], historyCapped,
    });
    const projected = projectSalaryCorrectionEvidence(assessment, []);
    assert.equal(projected.assessment.evidence, historyCapped ? "incomplete_history" : "current_profile_unverified");
    assert.equal(projected.assessment.rateDeltaPerBasisUnit, null);
    assert.equal(projected.assessment.payrollAmountDelta, null);
    assert.equal(projected.assessment.requiresIndependentPayrollRecalculation, true);
    assert.deepEqual(projected.assessment.before, historyCapped ? null : { payBasis: "monthly" });
    assert.deepEqual(projected.recentRevisions, []);
    assert.doesNotMatch(JSON.stringify(projected), /rateAmount|22000\.00|150\.00/);
  }
});

test("successful API response uses projected evidence rather than raw salary history", () => {
  const source = readFileSync("src/app/api/hcm/salary-corrections/preview/route.ts", "utf8");
  assert.match(source, /const publicEvidence = projectSalaryCorrectionEvidence\(assessment, history\)/);
  const responseStart = source.indexOf('status: "assessment_only"');
  assert.ok(responseStart >= 0);
  const response = source.slice(responseStart);
  assert.match(response, /assessment: publicEvidence\.assessment/);
  assert.match(response, /recentRevisions: publicEvidence\.recentRevisions/);
  assert.doesNotMatch(response, /recentRevisions:\s*history|\n\s*assessment,|\.\.\.(?:assessment|history)|rateAmount|previousRateAmount|newRateAmount/);
});
