import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/performance/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

test("performance HCM tables are tenant-scoped and employee-linked", () => {
  assert.ok(schema.includes("export const performanceCycles = pgTable("));
  assert.ok(schema.includes('"performance_cycles"'));
  assert.ok(schema.includes("export const performanceGoals = pgTable("));
  assert.ok(schema.includes('"performance_goals"'));
  assert.ok(schema.includes("export const performanceReviews = pgTable("));
  assert.ok(schema.includes('"performance_reviews"'));
  assert.ok(schema.includes('organizationId: integer("organization_id")'));
  assert.ok(schema.includes('employeeId: integer("employee_id")'));
  assert.ok(schema.includes('"performance_reviews_cycle_employee_unique"'));
});

test("performance API enforces authentication, role, tenant and org-unit scope", () => {
  assert.ok(route.includes("getSessionUser()"));
  assert.ok(route.includes("assertOrganizationRole("));
  assert.ok(route.includes("PERFORMANCE_ROLES"));
  assert.ok(route.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(route.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(route.includes("Performance cycles are organization-wide and require company-wide access."));
});

test("performance mutations use same-origin protection and audit logging", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("recordAuditEvent({"));
  assert.ok(route.includes('"Performance cycle created"'));
  assert.ok(route.includes('"Performance goal created"'));
  assert.ok(route.includes('"Performance review completed"'));
});

test("performance inputs have bounded progress, scores and goal weights", () => {
  assert.ok(route.includes("boundedWeight"));
  assert.ok(route.includes("n >= 0 && n <= 100"));
  assert.ok(route.includes("progress < 0 || progress > 100"));
  assert.ok(route.includes("n >= 1 && n <= 5"));
});

test("performance workspace is reachable from navigation and main renderer", () => {
  assert.ok(nav.includes('{ name: "Performance"'));
  assert.ok(workspace.includes('import { PerformancePanel }'));
  assert.ok(workspace.includes('page === "Performance"'));
});
