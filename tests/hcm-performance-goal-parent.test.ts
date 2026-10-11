import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateGoalParent } from "../src/lib/hcm-performance-goal-parent";

const parent = { scope: "team", orgUnitId: 8, cycleId: 55 };
const child = { scope: "employee", employeeOrgUnitId: 8, cycleId: 55 };

test("employee goal may cascade from same-unit team goal in the same cycle", () => {
  assert.equal(validateGoalParent(child, parent), null);
  assert.equal(validateGoalParent(
    { scope: "team", employeeOrgUnitId: null, cycleId: 55 },
    { scope: "company", orgUnitId: null, cycleId: 55 },
  ), null);
  assert.equal(validateGoalParent(
    { scope: "employee", employeeOrgUnitId: 8, cycleId: null },
    { scope: "team", orgUnitId: 8, cycleId: null },
  ), null);
});

test("mixed assigned/unassigned parent and child cycles are rejected both ways", () => {
  for (const [parentCycle, childCycle] of [[55, null], [null, 55], [55, 56]]) {
    assert.match(validateGoalParent(
      { ...child, cycleId: childCycle },
      { ...parent, cycleId: parentCycle },
    ) ?? "", /same performance cycle/);
  }
});

test("employee goal cannot bypass team tier or another unit", () => {
  assert.match(validateGoalParent(
    child, { scope: "company", orgUnitId: null, cycleId: 55 },
  ) ?? "", /must cascade from a team goal/);
  assert.match(validateGoalParent(
    { ...child, employeeOrgUnitId: 9 }, parent,
  ) ?? "", /employee's org unit/);
  assert.match(validateGoalParent(
    { ...child, employeeOrgUnitId: null }, parent,
  ) ?? "", /employee's org unit/);
});

test("company and team goals cannot be attached to wrong parent scope", () => {
  assert.match(validateGoalParent(
    { scope: "company", employeeOrgUnitId: null, cycleId: 55 }, parent,
  ) ?? "", /top-level/);
  assert.match(validateGoalParent(
    { scope: "team", employeeOrgUnitId: null, cycleId: 55 }, parent,
  ) ?? "", /company goal/);
  assert.match(validateGoalParent(child,
    { scope: "employee", orgUnitId: 8, cycleId: 55 },
  ) ?? "", /cannot be used as parents/);
});

test("existing performance mutation calls the goal-parent contract only after tenant-bound lookup", () => {
  const route = readFileSync("src/app/api/performance/route.ts", "utf8");
  const lookup = route.indexOf("eq(performanceGoals.organizationId, organizationId)");
  const call = route.indexOf("validateGoalParent({");
  assert.ok(lookup >= 0 && call > lookup);
  assert.ok(route.includes("if (parentError) return Response.json({ error: parentError }, { status: 400 })"));
  assert.ok(route.includes("cycleInOrganization(organizationId, cycleId)"));
});

test("parent picker only offers the requested cycle and a matching organizational tier", () => {
  const panel = readFileSync("src/components/performance-governance-panel.tsx", "utf8");
  assert.ok(panel.includes("goal.cycleId !== selectedCycleId"));
  assert.ok(panel.includes('goal.scope === "team" && selectedEmployeeUnitId !== null'));
  assert.ok(panel.includes("goal.orgUnitId === selectedEmployeeUnitId"));
  assert.ok(panel.includes('employeeId: event.target.value, parentGoalId: ""'));
  assert.ok(panel.includes('cycleId: event.target.value, parentGoalId: ""'));
});
