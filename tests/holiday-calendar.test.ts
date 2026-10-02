import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  holidayPayContextOn,
  holidaysOn,
  type HolidayCalendarEntry,
} from "../src/lib/wage-orders";

const calendar: HolidayCalendarEntry[] = [
  { date: "2026-04-09", name: "Regular A", kind: "regular" },
  { date: "2026-04-09", name: "Regular B", kind: "regular" },
  { date: "2026-05-01", name: "Regular C", kind: "regular" },
  { date: "2026-06-12", name: "Special A", kind: "special" },
  { date: "2026-07-01", name: "Regular D", kind: "regular" },
  { date: "2026-07-01", name: "Special B", kind: "special" },
];

test("holiday calendar preserves every declaration on the same date", () => {
  const matches = holidaysOn("2026-04-09", calendar);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((row) => row.name), ["Regular A", "Regular B"]);
});

test("two regular holidays on one date classify as a double regular holiday", () => {
  const context = holidayPayContextOn("2026-04-09", calendar);
  assert.equal(context.holiday, "double");
  assert.equal(context.holidays.length, 2);
  assert.match(context.label ?? "", /Regular A \+ Regular B/);
  assert.match(context.label ?? "", /double regular holiday/);
});

test("single regular, single special, and ordinary dates keep their existing classifications", () => {
  assert.equal(holidayPayContextOn("2026-05-01", calendar).holiday, "regular");
  assert.equal(holidayPayContextOn("2026-06-12", calendar).holiday, "special");
  assert.equal(holidayPayContextOn("2026-08-01", calendar).holiday, "ordinary");
});

test("mixed regular and special collision does not invent an unsupported combined multiplier", () => {
  const context = holidayPayContextOn("2026-07-01", calendar);
  assert.equal(context.holiday, "regular");
  assert.equal(context.holidays.length, 2);
  assert.match(context.label ?? "", /Regular D/);
  assert.doesNotMatch(context.label ?? "", /double/);
});


test("payroll engine consumes the classified holiday context instead of a single calendar row", () => {
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(engine.includes("holidayPayContextOn(punch.workDate)"));
  assert.ok(engine.includes("holiday: holidayContext.holiday"));
  assert.ok(engine.includes("holidayContext.holidays.length > 0"));
});
