import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedContributionCaseOutcomes,
  contributionCaseOutcomeAllowed,
} from "../src/lib/statutory-contribution-case-resolution";

test("missing posting cannot be closed as no issue found or employee advised", () => {
  assert.equal(contributionCaseOutcomeAllowed("missing_posting", "no_issue_found"), false);
  assert.equal(contributionCaseOutcomeAllowed("missing_posting", "employee_advised"), false);
  assert.equal(contributionCaseOutcomeAllowed("missing_posting", "posting_confirmed"), true);
  assert.equal(contributionCaseOutcomeAllowed("missing_posting", "correction_completed"), true);
  assert.equal(contributionCaseOutcomeAllowed("missing_posting", "referred_to_agency"), true);
});

test("wrong posted amount requires posting evidence, correction, or agency referral", () => {
  assert.deepEqual(
    allowedContributionCaseOutcomes("wrong_posted_amount"),
    ["posting_confirmed", "correction_completed", "referred_to_agency"],
  );
});

test("posting disputes with no linked member evidence can only be referred to the agency", () => {
  assert.deepEqual(
    allowedContributionCaseOutcomes("missing_posting", { hasLinkedPosting: false }),
    ["referred_to_agency"],
  );
  assert.equal(
    contributionCaseOutcomeAllowed(
      "wrong_posted_amount",
      "posting_confirmed",
      { hasLinkedPosting: false },
    ),
    false,
  );
});

test("unexpected deduction keeps investigation outcomes that fit that issue", () => {
  assert.deepEqual(
    allowedContributionCaseOutcomes("unexpected_deduction"),
    ["correction_completed", "no_issue_found", "employee_advised", "referred_to_agency"],
  );
});

test("missing payslip evidence cannot masquerade as an agency posting correction", () => {
  assert.deepEqual(
    allowedContributionCaseOutcomes("missing_payslip_evidence"),
    ["no_issue_found", "employee_advised"],
  );
  assert.equal(
    contributionCaseOutcomeAllowed("missing_payslip_evidence", "posting_confirmed"),
    false,
  );
});
