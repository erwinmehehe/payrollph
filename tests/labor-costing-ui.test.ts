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
});

test("labor costing UI supports effective-dated employee allocation batches", () => {
  assert.ok(panel.includes('"set_employee_allocations"'));
  assert.ok(panel.includes("effectiveFrom"));
  assert.ok(panel.includes("effectiveUntil"));
  assert.ok(panel.includes("clientCode"));
  assert.ok(panel.includes("projectCode"));
  assert.ok(panel.includes("jobCode"));
});

test("labor costing UI requires a 100 percent reconciled draft", () => {
  assert.ok(panel.includes("Allocation must total exactly 100.000%"));
  assert.ok(panel.includes("Math.abs(totalPercent - 100) > 0.001"));
});

test("labor costing UI makes wage-safety boundary explicit", () => {
  assert.ok(panel.includes("Finance allocation, not wage calculation"));
  assert.ok(panel.includes("does not change statutory wages"));
});
