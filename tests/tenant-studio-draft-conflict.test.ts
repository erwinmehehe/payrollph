import assert from "node:assert/strict";
import test from "node:test";
import { isAutomationDraftNameConflict } from "../src/lib/automation-draft-conflict";
test("only the exact employer/name uniqueness conflict is mapped through nested causes", () => {
  const pg = { code: "23505", constraint: "automation_rules_org_name_unique" };
  for (const error of [pg, new Error("wrapped", { cause: pg }), { cause: { cause: pg } }]) {
    assert.equal(isAutomationDraftNameConflict(error), true);
  }
  for (const error of [null, "23505", { code: "23505" }, { ...pg, code: "23503" },
    { ...pg, constraint: "other_unique" }, new Error("duplicate name"), { cause: { code: "08006" } }]) {
    assert.equal(isAutomationDraftNameConflict(error), false);
  }
});
test("cycles and unbounded wrappers cannot hang or disguise an unexpected error", () => {
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  assert.equal(isAutomationDraftNameConflict(cycle), false);
  let deep: unknown = { code: "23505", constraint: "automation_rules_org_name_unique" };
  for (let i = 0; i < 10; i++) deep = { cause: deep };
  assert.equal(isAutomationDraftNameConflict(deep), false);
});
