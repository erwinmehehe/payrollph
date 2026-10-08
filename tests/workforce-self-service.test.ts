import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/self/workforce/route.ts", "utf8");

test("employee WFM self-service derives employee and tenant scope from the authenticated session", () => {
  assert.ok(route.includes('session.role !== "employee"'));
  assert.ok(route.includes("session.employeeId"));
  assert.ok(route.includes("assertMembership(session.id, employee.organizationId)"));
  assert.equal(route.includes("body.organizationId"), false);
  assert.equal(route.includes("body.employeeId"), false);
  assert.ok(route.includes("eq(timePunches.employeeId, employee.id)"));
  assert.ok(route.includes("eq(timePunches.organizationId, employee.organizationId)"));
});

test("employee WFM self-service exposes only the authenticated employee schedule and attendance window", () => {
  assert.ok(route.includes("resolveEmployeeScheduleWindow({"));
  assert.ok(route.includes("employeeId: employee.id"));
  assert.ok(route.includes("organizationId: employee.organizationId"));
  assert.ok(route.includes("cannot exceed 42 days"));
  assert.ok(route.includes("attendanceCorrectionRequests.employeeId, employee.id"));
});

test("employee can request but cannot approve an attendance correction", () => {
  assert.ok(route.includes('action !== "request_correction"'));
  assert.equal(route.includes("decide_request"), false);
  assert.ok(route.includes("attendancePunchSnapshot(punch)"));
  assert.ok(route.includes("normalizeAttendanceCorrection({"));
  assert.ok(route.includes('status: "pending"'));
  assert.ok(route.includes("requestedByUserId: session.id"));
  assert.ok(route.includes("approvalRequired: true"));
  assert.ok(route.includes("payrollMutationPerformed: false"));
});

test("employee correction request fails closed against colleagues and duplicate pending requests", () => {
  assert.ok(route.includes("eq(timePunches.employeeId, employee.id)"));
  assert.ok(route.includes("eq(attendanceCorrectionRequests.employeeId, employee.id)"));
  assert.ok(route.includes('eq(attendanceCorrectionRequests.status, "pending")'));
  assert.ok(route.includes("already has a pending correction request"));
});

test("employee WFM mutation is same-origin protected, demo-safe, rate-limited and audited", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("publicDemoMutationDenied("));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes('"Employee self-service attendance correction requested"'));
});


test("employee time workspace surfaces governed schedule and correction request UI", () => {
  const panel = readFileSync("src/components/employee-workforce-panel.tsx", "utf8");
  const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");
  assert.ok(portal.includes("EmployeeWorkforcePanel"));
  assert.ok(panel.includes('fetch("/api/self/workforce"'));
  assert.ok(panel.includes("Effective workforce schedule"));
  assert.ok(panel.includes("Manager approval required"));
  assert.ok(panel.includes("Request correction"));
  assert.ok(panel.includes('"request_correction"'));
  assert.ok(panel.includes("This creates a pending request only."));
  assert.equal(panel.includes("organizationId"), false);
  assert.equal(panel.includes("employeeId"), false);
});
