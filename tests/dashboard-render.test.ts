import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CleanRoleDashboard } from "../src/components/workspace/clean-role-dashboard";
import { EmployeeHomeDashboard } from "../src/components/employee-home-dashboard";
import {
  dashboardFixture,
  employeeFixture,
  sampleRun,
} from "./fixtures/dashboard-ui";

const noop = () => {};
test("incomplete attendance keeps the input step current even after calculation", () => {
  const markup = renderToStaticMarkup(
    createElement(CleanRoleDashboard, {
      data: dashboardFixture,
      currentRun: sampleRun,
      role: "payroll",
      onPage: noop,
      onNewRun: noop,
    }),
  );
  assert.match(markup, /aria-current="step"><span>1<\/span><strong>Inputs/);
});
test("owner shows net funding but waits for server validation before declaring readiness", () => {
  const markup = renderToStaticMarkup(
    createElement(CleanRoleDashboard, {
      data: dashboardFixture,
      currentRun: { ...sampleRun, status: "Ready for release", exceptions: 0 },
      role: "owner",
      onPage: noop,
      onNewRun: noop,
    }),
  );
  assert.match(markup, /Net payroll funding/);
  assert.match(markup, /3,842,180/);
  assert.match(markup, /Continue payroll/);
  assert.doesNotMatch(markup, /All checks completed/);
  assert.doesNotMatch(markup, /Total funding required/);
});
test("checker never fabricates previous employee pay or offers approval with exceptions", () => {
  const markup = renderToStaticMarkup(
    createElement(CleanRoleDashboard, {
      data: dashboardFixture,
      currentRun: sampleRun,
      role: "checker",
      onPage: noop,
      onNewRun: noop,
    }),
  );
  assert.match(markup, /Unavailable/);
  assert.match(markup, /Review exceptions/);
  assert.doesNotMatch(markup, /Approve payroll/);
  assert.match(markup, /role="tablist"/);
});
test("employee sees only released pay and separate leave balances", () => {
  const markup = renderToStaticMarkup(
    createElement(EmployeeHomeDashboard, {
      data: employeeFixture,
      onPayslip: noop,
      onPay: noop,
      onAttendance: noop,
      onLeave: noop,
    }),
  );
  assert.match(markup, /28,450\.00/);
  assert.match(markup, /10 days/);
  assert.match(markup, /5 days/);
  assert.match(markup, /20 complete/);
  assert.doesNotMatch(markup, /22 days present|15 days available|3,842,180/);
  assert.ok(
    markup.indexOf("Latest payslip") < markup.indexOf("Recent payslips"),
  );
  assert.match(markup, /href="\/api\/self\/payslips\/10"/);
});
test("employee empty state does not claim a payslip or payday is available", () => {
  const markup = renderToStaticMarkup(
    createElement(EmployeeHomeDashboard, {
      data: {
        ...employeeFixture,
        nextPay: null,
        payslips: [],
        leave: { balances: [], requests: [] },
      },
      onPayslip: noop,
      onPay: noop,
      onAttendance: noop,
      onLeave: noop,
    }),
  );
  assert.match(markup, /Not scheduled yet/);
  assert.match(markup, /No released payslip yet/);
  assert.match(markup, /No leave policy assigned/);
  assert.doesNotMatch(markup, /View payslip|₱0\.00/);
});
