import assert from "node:assert/strict";
import test from "node:test";
import { formatPayrollPeriodLabel, isPreliminaryPayroll, manilaCalendarDate } from "../src/lib/payroll-period-ui";

test("Manila calendar date is correct across UTC day boundaries", () => {
  assert.equal(manilaCalendarDate(new Date("2026-10-10T17:00:00Z")), "2026-10-11");
  assert.equal(manilaCalendarDate(new Date("2026-10-11T15:59:59Z")), "2026-10-11");
  assert.equal(manilaCalendarDate(new Date("2026-10-11T16:00:00Z")), "2026-10-12");
});

test("in-progress calculated payroll is preliminary until period end", () => {
  const now = new Date("2026-10-11T02:00:00Z");
  assert.equal(isPreliminaryPayroll("2026-10-15", true, now), true);
  assert.equal(isPreliminaryPayroll("2026-10-15", false, now), false);
  assert.equal(isPreliminaryPayroll("2026-10-11", true, now), false);
  assert.equal(isPreliminaryPayroll("2026-10-10", true, now), false);
  assert.equal(isPreliminaryPayroll("unknown", true, now), false);
});

test("preliminary status rejects impossible future calendar dates", () => {
  const now = new Date("2026-10-11T02:00:00Z");
  for (const invalid of [
    "9999-99-99", "2027-02-29", "2027-02-30", "2027-04-31",
    "2027-13-01", "2027-00-01", "2027-01-00", "2027-01-32",
    "2027-1-01", " 2027-01-01", "2027-01-01 ",
    "2027-01-01T00:00:00Z",
  ]) {
    assert.equal(isPreliminaryPayroll(invalid, true, now), false, invalid);
  }
  assert.equal(isPreliminaryPayroll("2028-02-29", true, now), true,
    "a real future leap day remains preliminary");
  assert.equal(isPreliminaryPayroll("2027-01-01", true, now), true,
    "a valid future date remains preliminary");
  assert.equal(isPreliminaryPayroll("2028-02-29", false, now), false,
    "only calculated payroll is preliminary");
});

test("preliminary status uses Manila midnight, not the host time zone", () => {
  assert.equal(isPreliminaryPayroll("2026-10-12", true,
    new Date("2026-10-11T15:59:59Z")), true);
  assert.equal(isPreliminaryPayroll("2026-10-12", true,
    new Date("2026-10-11T16:00:00Z")), false);
});

test("payroll cutoff labels render valid same-month, cross-month and cross-year ranges", () => {
  assert.equal(formatPayrollPeriodLabel("2026-10-01", "2026-10-15"), "Oct 1–15, 2026");
  assert.equal(formatPayrollPeriodLabel("2026-10-16", "2026-10-31"), "Oct 16–31, 2026");
  assert.equal(formatPayrollPeriodLabel("2026-01-28", "2026-02-02"), "Jan 28–Feb 2, 2026");
  assert.equal(formatPayrollPeriodLabel("2026-12-29", "2027-01-04"), "Dec 29, 2026–Jan 4, 2027");
  assert.equal(formatPayrollPeriodLabel("2027-03-01", "2027-03-15"), "Mar 1–15, 2027");
});
