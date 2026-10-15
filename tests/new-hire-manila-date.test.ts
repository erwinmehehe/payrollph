import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { philippineCalendarDay } from "../src/lib/philippine-calendar-day";

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

test("direct new-hire source uses the Philippine default but preserves the editable field", () => {
  const source = readFileSync("src/components/new-hire-modal.tsx", "utf8");
  assert.match(source, /startDate: philippineCalendarDay\(new Date\(\)\)/);
  assert.doesNotMatch(source, /startDate: new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(source, /type="date" required value=\{form\.startDate\}/);
  assert.match(source, /onChange=\{\(e\) => setForm\(\{ \.\.\.form, startDate: e\.target\.value \}\)\}/);
});

test("recruitment candidate-to-hire also defaults to Philippine date for every open/reset", () => {
  const source = readFileSync("src/components/recruitment-panel.tsx", "utf8");
  assert.equal((source.match(/startDate: philippineCalendarDay\\(new Date\\(\\)\\),/g) ?? []).length, 2);
  assert.doesNotMatch(source, /startDate: new Date\\(\\)\\.toISOString\\(\\)\\.slice\\(0, 10\\)/);
  assert.match(source, /type="date" value=\\{hireForm\\.startDate\\}/);
  assert.match(source, /onChange=\\{\\(event\\) => setHireForm\\(\\{ \\.\\.\\.hireForm, startDate: event\\.target\\.value \\}\\)\\}/);
});
