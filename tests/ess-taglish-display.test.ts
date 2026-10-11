import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeHomeDashboard } from "../src/components/employee-home-dashboard";
import { employeeFixture } from "./fixtures/dashboard-ui";
import { essText, parseEssLanguage } from "../src/lib/ess-language";

const noop = () => {};

test("Taglish is an explicit opt-in and unknown values fall back to English", () => {
  assert.equal(parseEssLanguage("fil"), "fil");
  assert.equal(parseEssLanguage("en"), "en");
  assert.equal(parseEssLanguage("not-a-language"), "en");
  assert.equal(parseEssLanguage(null), "en");
  assert.equal(essText("en", "Next payday"), "Next payday");
  assert.equal(essText("fil", "Next payday"), "Susunod na payday");
  assert.equal(essText("fil", "SSS contribution - employee"), "SSS contribution - employee");
  assert.equal(essText("fil", "__proto__"), "__proto__");
});

test("Taglish dashboard changes copy, not payroll amounts, employee names or download links", () => {
  const props = {
    data: employeeFixture,
    onPayslip: noop, onPay: noop, onAttendance: noop,
    onLeave: noop, onRequestLeave: noop,
  };
  const english = renderToStaticMarkup(createElement(EmployeeHomeDashboard, props));
  const taglish = renderToStaticMarkup(createElement(EmployeeHomeDashboard, { ...props, language: "fil" as const }));
  assert.match(taglish, /Susunod na payday/);
  assert.match(taglish, /Natitirang leave/);
  assert.match(taglish, /Pinakabagong payslip/);
  assert.match(taglish, /28,450\.00/);
  assert.match(taglish, /href="\/api\/self\/payslips\/10"/);
  assert.match(english, /Next payday/);
  assert.doesNotMatch(taglish, /Next payday/);
});
