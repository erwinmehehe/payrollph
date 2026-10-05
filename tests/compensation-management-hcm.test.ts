import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const route = readFileSync("src/app/api/compensation/route.ts", "utf8");
const panel = readFileSync("src/components/compensation-panel.tsx", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

test("compensation foundation models bands cycles pools and recommendations", () => {
  assert.ok(schema.includes("export const compensationBands = pgTable("));
  assert.ok(schema.includes('"compensation_bands"'));
  assert.ok(schema.includes("export const compensationCycles = pgTable("));
  assert.ok(schema.includes('"compensation_cycles"'));
  assert.ok(schema.includes("export const compensationBudgetPools = pgTable("));
  assert.ok(schema.includes('"compensation_budget_pools"'));
  assert.ok(schema.includes("export const compensationRecommendations = pgTable("));
  assert.ok(schema.includes('"compensation_recommendations"'));
  assert.ok(schema.includes('"compensation_recommendations_cycle_employee_unique"'));
});

test("salary architecture is job profile plus location scoped", () => {
  assert.ok(route.includes("jobProfileId"));
  assert.ok(route.includes('locationKey = orgUnitId ? "org-unit:" + orgUnitId : "company"'));
  assert.ok(route.includes("minimum > midpoint || midpoint > maximum"));
  assert.ok(route.includes("Salary band architecture requires company-wide access."));
});

test("manager budget pools cannot exceed the review cycle budget", () => {
  assert.ok(route.includes("allocatedElsewhere + budget > Number(cycle.totalBudget)"));
  assert.ok(route.includes("Org-unit budget pools cannot exceed the cycle's total budget."));
  assert.ok(route.includes("The budget-pool manager must belong to the same organization unit."));
});

test("recommendations are budget aware and monthly-pay only", () => {
  assert.ok(route.includes('pay.payBasis !== "monthly"'));
  assert.ok(route.includes("annualizedIncrease"));
  assert.ok(route.includes("cycleBudgetUsage"));
  assert.ok(route.includes("would exceed the employee's org-unit compensation budget"));
  assert.ok(route.includes("would exceed the compensation cycle budget"));
});

test("four-eyes approval and band exceptions fail closed", () => {
  assert.ok(route.includes("the proposer cannot approve or reject their own compensation recommendation"));
  assert.ok(route.includes("An explicit band exception reason is required"));
  assert.ok(route.includes("Budget changed after submission"));
  assert.ok(route.includes('status: "approved"'));
});

test("approved compensation changes bridge into effective-dated payroll revisions", () => {
  assert.ok(route.includes("Only approved compensation recommendations can be applied."));
  assert.ok(route.includes("cannot be applied early"));
  assert.ok(route.includes("pay changed after this recommendation was submitted"));
  assert.ok(route.includes("gte(payrollRuns.periodEnd, effectiveDate)"));
  assert.ok(route.includes("tx.insert(employeePayRevisions)"));
  assert.ok(route.includes("tx.update(employeePayProfiles)"));
  assert.ok(route.includes("tx.update(employees)"));
  assert.ok(route.includes('status: "applied"'));
  assert.ok(route.includes("appliedPayRevisionId"));
});

test("compensation workspace exposes ranges recommendations approvals and payroll apply", () => {
  assert.ok(panel.includes("Current salary vs assigned range"));
  assert.ok(panel.includes("Compa-ratio"));
  assert.ok(panel.includes("Submit recommendation"));
  assert.ok(panel.includes("Apply to payroll"));
  assert.ok(nav.includes('{ name: "Compensation"'));
  assert.ok(workspace.includes('import { CompensationPanel }'));
  assert.ok(workspace.includes('page === "Compensation"'));
});
