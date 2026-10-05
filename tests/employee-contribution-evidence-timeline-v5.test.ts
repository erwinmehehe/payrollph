import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/self/contribution-evidence/route.ts", "utf8");

test("employee evidence timeline is scoped to the signed-in employee", () => {
  assert.ok(route.includes("eq(statutoryContributionIssueEvents.employeeId, employee.id)"));
  assert.ok(route.includes("eq(statutoryContributionIssueCases.employeeId, employee.id)"));
  assert.ok(route.includes("eq(statutoryRemittanceMembers.employeeId, employee.id)"));
});

test("employee export includes only employee-visible contribution case events", () => {
  assert.ok(route.includes('eq(statutoryContributionIssueEvents.visibility, "employee")'));
  assert.ok(route.includes("inArray(statutoryContributionIssueEvents.caseId, caseIds)"));
  assert.ok(route.includes("timeline: (eventsByCase.get(issue.id) ?? []).map"));
});

test("employee evidence pack records the timeline count in its audit metadata", () => {
  assert.ok(route.includes("contributionCaseTimelineEvents: caseEvents.length"));
  assert.ok(route.includes("Employee statutory contribution evidence exported"));
});

test("employee evidence notice explicitly states timeline visibility filtering", () => {
  assert.ok(route.includes("Contribution-case timeline entries are limited to events explicitly marked employee-visible."));
});
