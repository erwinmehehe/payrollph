/**
 * Validate an optional company -> team -> employee goal cascade.
 *
 * Unlike a flat goal list, inherited goals must remain in one appraisal cycle.
 * This is a pure, server-used validation contract: no score aggregation,
 * approval decision or payroll mutation is performed here.
 */
export type GoalParentContext = {
  scope: string;
  orgUnitId: number | null;
  cycleId: number | null;
};

export type GoalChildContext = {
  scope: string;
  employeeOrgUnitId: number | null;
  cycleId: number | null;
};

export function validateGoalParent(
  child: GoalChildContext,
  parent: GoalParentContext,
): string | null {
  if (child.scope === "company") {
    return "Company goals are top-level and cannot have a parent.";
  }
  if (parent.scope === "employee") {
    return "Employee goals cannot be used as parents in the company -> team -> employee hierarchy.";
  }
  if (child.scope === "team" && parent.scope !== "company") {
    return "Team goals may only cascade from a company goal.";
  }
  if (child.scope === "employee" && parent.scope !== "team") {
    return "Employee goals must cascade from a team goal when a parent is specified.";
  }
  if (child.scope === "employee" &&
    (child.employeeOrgUnitId === null || child.employeeOrgUnitId !== parent.orgUnitId)) {
    return "An employee goal can only cascade from a team goal in that employee's org unit.";
  }
  // Null and a concrete cycle are different scopes. Neither direction of
  // mixed cycle membership is safe; do not silently inherit a parent's cycle.
  if (child.cycleId !== parent.cycleId) {
    return "Parent and child goals must belong to the same performance cycle (including unassigned cycles).";
  }
  return null;
}
