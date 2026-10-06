import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("src/components/workspace/labor-costing-panel.tsx", "utf8");
const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");

test("workforce planner exposes enterprise labor costing", () => {
  assert.ok(planner.includes("LaborCostingPanel"));
  assert.ok(panel.includes("/api/workforce/labor-costing"));
});

test("labor costing UI creates cost centers through the secured API", () => {
  assert.ok(panel.includes('"create_cost_center"'));
  assert.ok(panel.includes("Create cost center"));
  assert.ok(panel.includes("maxLength={40}"));
  assert.ok(panel.includes("maxLength={140}"));
});

test("labor costing UI supports effective-dated employee allocation batches", () => {
  assert.ok(panel.includes('"set_employee_allocations"'));
  assert.ok(panel.includes("effectiveFrom"));
  assert.ok(panel.includes("effectiveUntil"));
  assert.ok(panel.includes("clientCode"));
  assert.ok(panel.includes("projectCode"));
  assert.ok(panel.includes("jobCode"));
});

test("labor costing UI requires a reconciled and valid allocation draft", () => {
  assert.ok(panel.includes("Allocation must total exactly 100.000%"));
  assert.ok(panel.includes("Math.abs(totalPercent - 100) <= 0.001"));
  assert.ok(panel.includes("inactiveOrMissingCenter"));
  assert.ok(panel.includes("invalidPercent"));
  assert.ok(panel.includes("dateRangeInvalid"));
});

test("labor costing UI blocks duplicate finance dimension rows", () => {
  assert.ok(panel.includes("normalizeDimensionCode"));
  assert.ok(panel.includes("duplicateDimensions"));
  assert.ok(panel.includes("Duplicate cost center/client/project/job combinations are not allowed"));
});

test("employee and organization changes cannot silently reuse stale draft state", () => {
  assert.ok(panel.includes("resetDraftForEmployee"));
  assert.ok(panel.includes("setDrafts([blankDraft(1)]);"));
  assert.ok(panel.includes("setEmployeeId(data.employees[0]?.id ?? 0);"));
});

test("labor costing UI can seed a new version from the employee's latest plan", () => {
  assert.ok(panel.includes("copyLatestPlan"));
  assert.ok(panel.includes("Copy latest plan"));
  assert.ok(panel.includes("Updated from allocation effective"));
});

test("allocation history exposes effective status and audit reason", () => {
  assert.ok(panel.includes("windowStatus"));
  assert.ok(panel.includes("row.reason"));
  assert.ok(panel.includes("Effective dates and reasons are retained"));
});

test("labor costing UI makes wage-safety boundary explicit", () => {
  assert.ok(panel.includes("Finance allocation, not wage calculation"));
  assert.ok(panel.includes("does not change statutory wages"));
});
