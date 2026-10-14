import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { manilaMonthEnd, syntheticEpoch } =
  require("../scripts/qa/synthetic-month-end.cjs");

test("CI month-end is current Manila month, including UTC date rollover", () => {
  assert.equal(manilaMonthEnd(Date.parse("2026-10-14T08:00:00Z")), "2026-10-31");
  assert.equal(manilaMonthEnd(Date.parse("2026-10-31T15:59:00Z")), "2026-10-31");
  assert.equal(manilaMonthEnd(Date.parse("2026-10-31T16:01:00Z")), "2026-11-30");
  assert.equal(manilaMonthEnd(Date.parse("2026-12-31T16:01:00Z")), "2027-01-31");
  assert.equal(manilaMonthEnd(Date.parse("2024-02-14T09:00:00Z")), "2024-02-29");
  assert.equal(manilaMonthEnd(Date.parse("2026-02-14T09:00:00Z")), "2026-02-28");
});
test("only real final cutoffs can become the 16:00 Asia/Manila synthetic clock", () => {
  assert.equal(new Date(syntheticEpoch("2026-10-31")).toISOString(),
    "2026-10-31T08:00:00.000Z");
  assert.equal(new Date(syntheticEpoch("2024-02-29")).toISOString(),
    "2024-02-29T08:00:00.000Z");
  for (const date of ["2026-02-29", "2026-10-30", "2026-11-31",
    "2026-10-00", "2026-13-31", "not-a-date", "2026-10-31T08:00Z"]) {
    assert.throws(() => syntheticEpoch(date), /month-end|YYYY-MM-DD/);
  }
});
test("malformed wall-clock inputs are not treated as payroll cutoffs", () => {
  assert.throws(() => manilaMonthEnd(NaN), /Invalid wall clock/);
  assert.throws(() => manilaMonthEnd(Infinity), /Invalid wall clock/);
});
