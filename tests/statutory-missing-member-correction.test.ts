import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/compliance/statutory-remittance-corrections/route.ts",
  "utf8",
);
const issuePanel = readFileSync(
  "src/components/workspace/statutory-contribution-issue-cases-panel.tsx",
  "utf8",
);
const correctionPanel = readFileSync(
  "src/components/workspace/statutory-remittance-corrections-panel.tsx",
  "utf8",
);

test("missing-member correction starts from an employee case, not freeform employee amounts", () => {
  assert.ok(route.includes('action === "request_missing_member_correction"'));
  assert.ok(route.includes("deriveMissingMemberAddition(organizationId, caseId)"));
  assert.ok(route.includes('issue.issueType !== "missing_posting"'));
  assert.ok(route.includes("buildStatutoryRemittanceSnapshot"));
  assert.ok(route.includes("Released before a missing member can be derived"));
  assert.ok(!route.includes("body.employeeShare"));
  assert.ok(!route.includes("body.employerShare"));
});

test("missing-member proposal verifies existing batch membership and snapshot hash", () => {
  assert.ok(route.includes("Batch employee count does not match its member rows"));
  assert.ok(route.includes("Batch liability totals do not match existing member rows"));
  assert.ok(route.includes("currentSnapshotHash !== batch.snapshotHash"));
  assert.ok(route.includes("statutoryRemittanceSnapshotHash"));
});

test("missing-member correction requires independent approval and revalidation", () => {
  assert.ok(route.includes("correction.requestedByUserId === user.id"));
  assert.ok(route.includes('correction.targetType === "member_addition"'));
  assert.ok(route.includes("deriveMissingMemberAddition(organizationId, caseId)"));
  assert.ok(route.includes("Payroll or remittance data changed after this missing-member correction was requested"));
});

test("approval atomically adds the member, expands liability, and reopens compliance", () => {
  assert.ok(route.includes("tx.insert(statutoryRemittanceMembers)"));
  assert.ok(route.includes('postingStatus: "exception"'));
  assert.ok(route.includes("expectedEmployeeShare: proposed.batchExpectedEmployeeShare"));
  assert.ok(route.includes("expectedEmployerShare: proposed.batchExpectedEmployerShare"));
  assert.ok(route.includes("expectedTotal: proposed.batchExpectedTotal"));
  assert.ok(route.includes("snapshotHash: proposed.batchSnapshotHash"));
  assert.ok(route.includes('status: "exception"'));
  assert.ok(route.includes("remittanceMemberId: newMember.id"));
  assert.ok(route.includes('eventType: "missing_member_added"'));
});

test("case review UI exposes missing-member correction only when no member is linked", () => {
  assert.ok(issuePanel.includes('issue.issueType === "missing_posting"'));
  assert.ok(issuePanel.includes("issue.remittanceMemberId == null"));
  assert.ok(issuePanel.includes("request_missing_member_correction"));
  assert.ok(issuePanel.includes("Request missing-member correction"));
});

test("correction approval UI renders missing-member requests as a distinct target", () => {
  assert.ok(correctionPanel.includes('"member_addition"'));
  assert.ok(correctionPanel.includes("Missing member"));
  assert.ok(correctionPanel.includes("Missing remittance member"));
});
