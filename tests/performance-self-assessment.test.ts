import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const selfRoute = readFileSync("src/app/api/self/performance/route.ts", "utf8");
const selfPanel = readFileSync("src/components/hcm-self-performance.tsx", "utf8");
const managerPanel = readFileSync("src/components/performance-panel.tsx", "utf8");
const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");

test("employee self-assessment is bound to the signed-in employee", () => {
  assert.ok(selfRoute.includes('session.role !== "employee"'));
  assert.ok(selfRoute.includes("session.employeeId"));
  assert.ok(selfRoute.includes("assertMembership(session.id, employee.organizationId)"));
  assert.ok(selfRoute.includes("eq(performanceReviews.employeeId, context.employee.id)"));
  assert.ok(selfRoute.includes("eq(performanceReviews.organizationId, context.employee.organizationId)"));
});

test("self-assessment mutations are protected, bounded and locked after completion", () => {
  assert.ok(selfRoute.includes("enforceSameOriginMutation(request)"));
  assert.ok(selfRoute.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(selfRoute.includes("n >= 1 && n <= 5"));
  assert.ok(selfRoute.includes('existing.status === "completed"'));
  assert.ok(selfRoute.includes("employeeReflection.length"));
  assert.ok(selfRoute.includes("Performance self-assessment submitted"));
});

test("employee self-service exposes performance without taking over the final rating", () => {
  assert.ok(portal.includes('["performance", "Performance"]'));
  assert.ok(portal.includes("<HcmSelfPerformance />"));
  assert.ok(selfPanel.includes("the final rating remains a separate manager decision"));
  assert.ok(selfPanel.includes('fetch("/api/self/performance"'));
});

test("manager performance UI shows employee-provided evidence separately", () => {
  assert.ok(managerPanel.includes("Employee self-assessment:"));
  assert.ok(managerPanel.includes("Employee reflection:"));
  assert.ok(managerPanel.includes("Manager summary:"));
});
