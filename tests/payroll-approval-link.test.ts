import test from "node:test";
import assert from "node:assert/strict";
import { approvalBelongsToPayrollRun } from "../src/lib/payroll-approval-link";
const run = { id: 12, organizationId: 7 };
const on = { EXACT_PAYROLL_APPROVAL_LINKS_ENABLED: "true" };
const task = (payrollRunId: number | null, detail: string, organizationId = 7) => ({ organizationId, payrollRunId, detail });
test("exact payroll FK prevents prefix collisions and ignores misleading display text", () => {
  assert.equal(approvalBelongsToPayrollRun(task(123, "Payroll run #123 · review"), run, on), false);
  assert.equal(approvalBelongsToPayrollRun(task(123, "Payroll run #12 · misleading"), run, on), false);
  assert.equal(approvalBelongsToPayrollRun(task(12, "renamed review"), run, on), true);
  assert.equal(approvalBelongsToPayrollRun(task(12, "Payroll run #12", 8), run, on), false);
});
test("legacy null-FK tasks match a whole canonical leading run number", () => {
  for (const detail of ["Payroll run #12", "Payroll run #12 · review", "Payroll run #12 review"]) {
    assert.equal(approvalBelongsToPayrollRun(task(null, detail), run, on), true);
  }
  for (const detail of ["Payroll run #123", "Payroll run #120", "Payroll run #12x", "Payroll run #12.3", "Payroll run #012", "Note Payroll run #12", "Payroll run #12e2"]) {
    assert.equal(approvalBelongsToPayrollRun(task(null, detail), run, on), false);
  }
});
test("default-off preserves executed legacy matching including the reproduced 12/123 collision", () => {
  const oldTask = task(123, "Payroll run #123 · review");
  for (const env of [{}, { EXACT_PAYROLL_APPROVAL_LINKS_ENABLED: "false" }, { EXACT_PAYROLL_APPROVAL_LINKS_ENABLED: "TRUE" }]) {
    assert.equal(approvalBelongsToPayrollRun(oldTask, run, env), true);
    for (const detail of ["unrelated", "Payroll run #12", "prefix Payroll run #120"]) {
      assert.equal(approvalBelongsToPayrollRun(task(null, detail), run, env), detail.includes("Payroll run #12"));
    }
  }
});
