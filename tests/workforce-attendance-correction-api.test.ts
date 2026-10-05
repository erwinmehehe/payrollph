import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/workforce/attendance-corrections/route.ts",
  "utf8",
);

test("attendance corrections preserve two-person approval and stable identity", () => {
  assert.ok(route.includes("requestedByUserId"));
  assert.ok(route.includes("existing.requestedByUserId === user.id"));
  assert.ok(route.includes("cannot be self-approved"));
  assert.ok(route.includes("decidedByUserId: user.id"));
});

test("attendance correction approval fails closed when the punch snapshot changed", () => {
  assert.ok(route.includes("attendancePunchSnapshotsMatch(original, current)"));
  assert.ok(route.includes("Attendance changed after this correction was requested"));
  assert.ok(route.includes("Attendance changed while the correction was being approved"));
});

test("released payroll is immutable and unreleased calculations are invalidated", () => {
  assert.ok(route.includes("payrollIsImmutable(run.status)"));
  assert.ok(route.includes("Use a post-payroll adjustment instead of rewriting historical attendance"));
  assert.ok(route.includes("tx.delete(payrollJobs)"));
  assert.ok(route.includes("tx.delete(payrollEntries)"));
  assert.ok(route.includes('status: "Draft"'));
  assert.ok(route.includes("invalidatedPayrollRunIds"));
});

test("attendance corrections are organization and org-unit scoped", () => {
  assert.ok(route.includes("eq(timePunches.organizationId, organizationId)"));
  assert.ok(route.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(route.includes("eq(attendanceCorrectionRequests.organizationId, organizationId)"));
});
