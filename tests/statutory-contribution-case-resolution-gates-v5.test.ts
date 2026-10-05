import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-contribution-issue-cases-panel.tsx", "utf8");
const notifications = readFileSync("src/lib/statutory-contribution-case-notifications.ts", "utf8");

test("correction_completed requires an approved applied audited correction", () => {
  assert.ok(route.includes('resolutionOutcome === "correction_completed"'));
  assert.ok(route.includes("statutoryRemittanceCorrectionRequests"));
  assert.ok(route.includes('eq(statutoryRemittanceCorrectionRequests.status, "approved")'));
  assert.ok(route.includes("correction.appliedAt != null"));
  assert.ok(route.includes("Complete the audited correction workflow first."));
});

test("member-linked cases require the correction to target the linked posting", () => {
  assert.ok(route.includes('correction.targetType === "member_posting"'));
  assert.ok(route.includes("correction.memberId === issue.remittanceMemberId"));
  assert.ok(route.includes('correction.targetType === "batch_payment"'));
});

test("agency referral remains in review instead of pretending the case is resolved", () => {
  assert.ok(route.includes('resolutionOutcome === "referred_to_agency"'));
  assert.ok(route.includes('status: "in_review"'));
  assert.ok(route.includes('status: "in_progress"'));
  assert.ok(route.includes("resolvedAt: null"));
  assert.ok(route.includes("resolved: false"));
  assert.ok(route.includes("Employee contribution issue referred to agency"));
});

test("agency referral writes an employee-visible immutable timeline event", () => {
  assert.ok(route.includes('eventType: "referred_to_agency"'));
  assert.ok(route.includes('visibility: "employee"'));
  assert.ok(route.includes("Referred to the agency for verification."));
});

test("employee and payroll UI communicate that referral keeps the case open", () => {
  assert.ok(notifications.includes('event: "review_started" | "referred" | "resolved"'));
  assert.ok(notifications.includes("Your PayrollPH case remains open while the agency response is pending."));
  assert.ok(panel.includes("Referred to agency · keep case open"));
  assert.ok(panel.includes("Contribution case referred to the agency and kept open."));
});
