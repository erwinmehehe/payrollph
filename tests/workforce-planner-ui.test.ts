import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const roles = readFileSync("src/lib/workspace-role-ui.ts", "utf8");

test("workforce planner is a first-class workspace destination", () => {
  assert.ok(nav.includes('{ name: "Workforce"'));
  assert.ok(workspace.includes('page === "Workforce"'));
  assert.ok(workspace.includes("<WorkforcePlanner"));
  assert.ok(roles.includes('"Workforce"'));
});

test("planner uses bounded range preview and secured schedule mutations", () => {
  assert.ok(planner.includes("startDate: rangeStart"));
  assert.ok(planner.includes("endDate: rangeEnd"));
  assert.ok(planner.includes('fetch("/api/workforce/schedules"'));
  for (const action of ["create_shift", "create_pattern", "assign_schedule", "create_override"]) {
    assert.ok(planner.includes(`"${action}"`), `missing planner action ${action}`);
  }
});

test("planner exposes payroll-relevant scheduling controls", () => {
  assert.ok(planner.includes("14-day roster preview"));
  assert.ok(planner.includes("Build a seven-day pattern"));
  assert.ok(planner.includes("Apply a rotation with an effective date"));
  assert.ok(planner.includes("Override a shift or rest day"));
});

test("payroll-only role is not granted the People-admin workforce page", () => {
  const payrollBlock = roles.slice(roles.indexOf("  payroll: ["), roles.indexOf("  checker: ["));
  assert.ok(!payrollBlock.includes('"Workforce"'));
});
