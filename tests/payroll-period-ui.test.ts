import assert from "node:assert/strict";
import test from "node:test";
import { isPreliminaryPayroll, manilaCalendarDate } from "../src/lib/payroll-period-ui";

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
