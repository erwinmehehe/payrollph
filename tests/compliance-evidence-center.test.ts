import assert from "node:assert/strict";
import test from "node:test";
import { calculateComplianceEvidenceScore } from "../src/lib/compliance-evidence-score";

test("evidence score reaches 100 only when every tracked domain has proof", () => {
  const result = calculateComplianceEvidenceScore({
    activeApprovedRules: 4,
    latestPayrollBlockingFindings: 0,
    acceptedFilingForms: 4,
    requiredFilingForms: 4,
    dueRemittanceObligations: 6,
    confirmedDueRemittances: 6,
    overdueRemittances: 0,
    acceptedBankValidations: 1,
  });
  assert.equal(result.score, 100);
  assert.ok(result.domains.every((domain) => domain.status === "proven"));
});

test("absence of operational evidence never receives free points", () => {
  const result = calculateComplianceEvidenceScore({
    activeApprovedRules: 0,
    latestPayrollBlockingFindings: null,
    acceptedFilingForms: 0,
    requiredFilingForms: 4,
    dueRemittanceObligations: 0,
    confirmedDueRemittances: 0,
    overdueRemittances: 0,
    acceptedBankValidations: 0,
  });
  assert.equal(result.score, 0);
  assert.ok(result.domains.every((domain) => domain.status === "missing"));
});

test("an overdue remittance is explicitly blocking and only confirmed due obligations score", () => {
  const result = calculateComplianceEvidenceScore({
    activeApprovedRules: 1,
    latestPayrollBlockingFindings: 0,
    acceptedFilingForms: 2,
    requiredFilingForms: 4,
    dueRemittanceObligations: 4,
    confirmedDueRemittances: 3,
    overdueRemittances: 1,
    acceptedBankValidations: 1,
  });
  const remittance = result.domains.find((domain) => domain.key === "remittance");
  assert.equal(remittance?.status, "blocked");
  assert.equal(remittance?.points, 15);
  assert.equal(result.score, 85);
});
