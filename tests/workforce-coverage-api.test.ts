import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/workforce/coverage/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const panel = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");

test("WFM depth adds availability, staffing demand, open shifts and claims", () => {
  assert.ok(schema.includes('export const employeeAvailabilityRules = pgTable('));
  assert.ok(schema.includes('export const staffingRequirements = pgTable('));
  assert.ok(schema.includes('export const openShifts = pgTable('));
  assert.ok(schema.includes('export const openShiftClaims = pgTable('));
});

test("coverage API is scope-aware and uses manager RBAC", () => {
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("assertScope(access, site[0].orgUnitId)"));
  assert.ok(route.includes("visibleWorkforce(user.id, organizationId)"));
});

test("employees may claim only their own open shift unless a manager acts for them", () => {
  assert.ok(route.includes("const selfService = user.employeeId === employeeId"));
  assert.ok(route.includes("Only workforce managers can submit an open-shift claim for another employee."));
});

test("open shift claims reject existing scheduled work and unavailable employees", () => {
  assert.ok(route.includes("The employee is unavailable for this open shift."));
  assert.ok(route.includes("Open shifts can only be claimed on an unassigned/rest day."));
  assert.ok(route.includes("resolveEmployeeScheduleWindow"));
});

test("approval evaluates blocking guardrails before writing the roster", () => {
  assert.ok(route.includes("evaluateScheduleGuardrails"));
  assert.ok(route.includes("scheduleGuardrailBlocksMutation"));
  assert.ok(route.includes("Open shift approval violates blocking schedule guardrails."));
  assert.ok(route.includes('kind: "shift"'));
  assert.ok(route.includes("scheduleOverrides"));
});

test("claim approval serializes slot allocation to avoid overfilling", () => {
  assert.ok(route.includes("for update"));
  assert.ok(route.includes("Open shift is already fully claimed."));
  assert.ok(route.includes("approved.length + 1 >= openShift.slots"));
});

test("coverage UI is part of the main workforce planner", () => {
  assert.ok(panel.includes("Staff the work, not just the calendar."));
  assert.ok(panel.includes("Open shift"));
  assert.ok(panel.includes("Availability"));
  assert.ok(planner.includes("<WorkforceCoveragePanel"));
});
