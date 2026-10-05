import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/compliance/contribution-issues/evidence/route.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/workspace/statutory-contribution-issue-cases-panel.tsx",
  "utf8",
);

test("case evidence export requires company-wide payroll authorization", () => {
  assert.ok(route.includes("getAccess(user.id, organizationId)"));
  assert.ok(route.includes("!access.companyWide"));
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)"));
});

test("case lookup is tenant-scoped and joins the exact employee record", () => {
  assert.ok(route.includes("eq(statutoryContributionIssueCases.id, caseId)"));
  assert.ok(route.includes("eq(statutoryContributionIssueCases.organizationId, organizationId)"));
  assert.ok(route.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(route.includes("eq(payrollEntries.employeeId, issue.employeeId)"));
  assert.ok(route.includes("eq(statutoryRemittanceMembers.employeeId, issue.employeeId)"));
});

test("evidence preserves original employee snapshot separately from current records", () => {
  assert.ok(route.includes("reportedSnapshot: issue.employeeSnapshot"));
  assert.ok(route.includes("currentRemittanceEvidence:"));
  assert.ok(route.includes("later corrections do not rewrite the original report context"));
});

test("case evidence export is private, rate-limited, audited and downloadable", () => {
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes("Employee contribution case evidence exported"));
  assert.ok(route.includes('"Content-Disposition"'));
  assert.ok(route.includes('"Cache-Control": "no-store, private"'));
  assert.ok(route.includes("buildContributionEvidencePack(payload)"));
});

test("payroll reviewers can download evidence from open and resolved case views", () => {
  assert.ok(panel.includes("/api/compliance/contribution-issues/evidence?organizationId="));
  assert.ok(panel.includes("<Download"));
  assert.ok(panel.includes("Download evidence"));
});
