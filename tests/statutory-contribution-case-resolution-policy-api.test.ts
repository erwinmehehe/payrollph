import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-contribution-issue-cases-panel.tsx", "utf8");

test("server enforces issue-specific resolution policy before evidence-specific gates", () => {
  assert.ok(api.includes("contributionCaseOutcomeAllowed("));
  assert.ok(api.includes("hasLinkedPosting: issue.remittanceMemberId != null"));
  assert.ok(api.indexOf("contributionCaseOutcomeAllowed(") < api.indexOf('resolutionOutcome === "posting_confirmed"'));
});

test("payroll UI only renders outcomes allowed for the reported issue", () => {
  assert.ok(panel.includes("allowedContributionCaseOutcomes("));
  assert.ok(panel.includes("issue.issueType"));
  assert.ok(panel.includes("hasLinkedPosting: issue.remittanceMemberId != null"));
  assert.ok(panel.includes("contributionCaseResolutionPolicyMessage(issue.issueType)"));
});

test("posting-confirmed and correction-completed still require real underlying evidence", () => {
  assert.ok(api.includes('resolutionOutcome === "posting_confirmed"'));
  assert.ok(api.includes('member.postingStatus !== "confirmed"'));
  assert.ok(api.includes('resolutionOutcome === "correction_completed"'));
  assert.ok(api.includes("correction.appliedAt != null"));
  assert.ok(api.includes('correction.targetType === "member_posting"'));
});
