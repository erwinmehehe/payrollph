import assert from "node:assert/strict";
import test from "node:test";
import { philippineCalendarDay, newHireCalendarDay } from "../src/lib/philippine-calendar-day";

test("new-hire date follows Asia/Manila, not UTC midnight or client timezone", () => {
  assert.equal(philippineCalendarDay(new Date("2026-10-14T15:59:59.999Z")), "2026-10-14");
  assert.equal(philippineCalendarDay(new Date("2026-10-14T16:00:00.000Z")), "2026-10-15");
  assert.equal(philippineCalendarDay(new Date("2026-10-15T00:00:00.000Z")), "2026-10-15");
  assert.equal(philippineCalendarDay(new Date("2026-10-15T15:59:59.999Z")), "2026-10-15");
  assert.equal(philippineCalendarDay(new Date("2026-10-15T16:00:00.000Z")), "2026-10-16");
});

test("year rollover and leap day use the actual Philippine civil date", () => {
  assert.equal(philippineCalendarDay(new Date("2026-12-31T15:59:59.999Z")), "2026-12-31");
  assert.equal(philippineCalendarDay(new Date("2026-12-31T16:00:00.000Z")), "2027-01-01");
  assert.equal(philippineCalendarDay(new Date("2024-02-28T16:00:00.000Z")), "2024-02-29");
});

test("flag-off preserves every original UTC default while enabled uses Manila", () => {
  for (const iso of ["2026-10-14T15:59:59.999Z", "2026-10-14T16:00:00Z", "2026-12-31T16:00:00Z", "2024-02-28T16:00:00Z"]) {
    const date = new Date(iso);
    assert.equal(newHireCalendarDay(date), date.toISOString().slice(0, 10));
    assert.equal(newHireCalendarDay(date, false), date.toISOString().slice(0, 10));
    assert.equal(newHireCalendarDay(date, true), philippineCalendarDay(date));
  }
});

test("invalid instants fail rather than silently inventing employment dates", () => {
  for (const enabled of [false, true]) {
    assert.throws(() => newHireCalendarDay(new Date(NaN), enabled), RangeError);
  }
});
