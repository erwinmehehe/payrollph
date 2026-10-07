import assert from "node:assert/strict";
import test from "node:test";
import { dashboardPayrollSummary } from "../src/lib/dashboard-presentation";
import type { PayrollRun } from "../src/components/workspace/types";

const run = {
  id: 1,
  status: "Ready for release",
  grossPay: "4200",
  netPay: "3800",
  employeeCount: 2,
  exceptions: 0,
  payDate: "2026-10-15",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-15",
} as PayrollRun;

test("an empty workspace never presents zero payroll as ready for release", () => {
  const summary = dashboardPayrollSummary(undefined, 0);
  assert.equal(summary.readyForRelease, false);
  assert.equal(summary.calculated, false);
  assert.equal(summary.gross, null);
  assert.equal(summary.net, null);
});

test("release funding uses stored net pay and requires no visible blockers", () => {
  const summary = dashboardPayrollSummary(run, 0);
  assert.equal(summary.net, 3800);
  assert.equal(summary.deductions, 400);
  assert.equal(summary.readyForRelease, true);
  assert.equal(dashboardPayrollSummary(run, 1).readyForRelease, false);
  assert.equal(
    dashboardPayrollSummary({ ...run, exceptions: 1 }, 0).readyForRelease,
    false,
  );
});

test("draft figures are unavailable and released runs do not offer another release", () => {
  assert.equal(
    dashboardPayrollSummary({ ...run, status: "Draft" }, 0).net,
    null,
  );
  const released = dashboardPayrollSummary({ ...run, status: "Released" }, 0);
  assert.equal(released.released, true);
  assert.equal(released.readyForRelease, false);
});
