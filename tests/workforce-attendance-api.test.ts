import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/workforce/attendance-exceptions/route.ts", "utf8");

test("attendance exception API is tenant and employee scoped", () => {
  assert.ok(source.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(source.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(source.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(source.includes("eq(timePunches.organizationId, organizationId)"));
  assert.ok(source.includes("eq(overtimeRequests.organizationId, organizationId)"));
});

test("attendance exception range is bounded to 42 days", () => {
  assert.ok(source.includes("dates.length > 42"));
  assert.ok(source.includes("range is limited to 42 days"));
});

test("attendance exception API resolves effective schedules before analysis", () => {
  assert.ok(source.includes("resolveDailySchedule({"));
  assert.ok(source.includes("analyzeAttendanceDay({"));
  assert.ok(source.includes("employeeScheduleAssignments"));
  assert.ok(source.includes("scheduleOverrides"));
});

test("attendance exception API includes overtime authorization evidence", () => {
  assert.ok(source.includes("requestedByUserId: ot.requestedByUserId"));
  assert.ok(source.includes("decidedByUserId: ot.decidedByUserId"));
});
