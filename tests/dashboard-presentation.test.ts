import assert from "node:assert/strict";
import test from "node:test";
import { dashboardMoney, dashboardPayrollSummary, verifiedDashboardAmount } from "../src/lib/dashboard-presentation";
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

test("dashboard displays exact stored centavos, including genuine zero and negatives", () => {
  const amounts: Array<[string | number, number, string]> = [
    ["1234.50", 1234.5, "₱1,234.50"],
    ["0.01", 0.01, "₱0.01"],
    ["0.00", 0, "₱0.00"],
    [0, 0, "₱0.00"],
    ["-5.25", -5.25, "-₱5.25"],
  ];
  for (const [stored, amount, formatted] of amounts) {
    assert.equal(verifiedDashboardAmount(stored), amount, String(stored));
    assert.equal(dashboardMoney(stored), formatted, String(stored));
  }
  const centavoRun = dashboardPayrollSummary({
    ...run, grossPay: "1000.01", netPay: "750.01",
  }, 0);
  assert.equal(centavoRun.calculated, true);
  assert.equal(centavoRun.gross, 1000.01);
  assert.equal(centavoRun.net, 750.01);
  assert.equal(centavoRun.deductions, 250);
  assert.equal(centavoRun.readyForRelease, true);
});

test("dashboard never rounds bad or sub-centavo values into plausible payroll money", () => {
  for (const value of [
    null, undefined, "", " ", "NaN", "Infinity", "1e3", "1,000.00",
    "1.001", " 0.00", "0.00 ", "+5.00", "00.50",
    true, {}, [], Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    0.001, "90071992547409.92", Number.MAX_SAFE_INTEGER,
  ]) {
    assert.equal(verifiedDashboardAmount(value), null, String(value));
    if (value === null || value === undefined || typeof value === "string" || typeof value === "number") {
      assert.equal(dashboardMoney(value), "—", String(value));
    }
  }
});

test("corrupt stored dashboard figures cannot look calculated or ready for release", () => {
  for (const [field, badValue] of [
    ["grossPay", "4200.001"],
    ["netPay", "3800.001"],
    ["grossPay", "1e3"],
    ["netPay", " 3800.00"],
    ["netPay", "90071992547409.92"],
  ] as const) {
    const summary = dashboardPayrollSummary({ ...run, [field]: badValue }, 0);
    assert.equal(summary.calculated, false, field + " " + badValue);
    assert.equal(summary.gross, null);
    assert.equal(summary.net, null);
    assert.equal(summary.deductions, null);
    assert.equal(summary.readyForRelease, false);
    assert.equal(summary.released, false);
  }
});
