import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  manilaWorkDate, summarizeUpcomingWeek, upcomingSevenDays,
  type EmployeeUpcomingSourceDay,
} from "../src/lib/workforce-employee-upcoming-week";

const shift = {
  shiftCode: "DAY", startTime: "09:00", endTime: "17:00", spansMidnight: false,
};
const night = {
  shiftCode: "NIGHT", startTime: "22:00", endTime: "06:00", spansMidnight: true,
};
const day = (date: string, changes: Partial<EmployeeUpcomingSourceDay> = {}): EmployeeUpcomingSourceDay => ({
  date, source: "pattern", isRestDay: false, segments: [shift], ...changes,
});

test("upcoming employee week includes today and six more Manila work dates", () => {
  const week = upcomingSevenDays([day("2026-10-10")], "2026-10-10");
  assert.equal(week.length, 7);
  assert.equal(week[0].date, "2026-10-10");
  assert.equal(week[6].date, "2026-10-16");
  assert.equal(week[0].state, "shift");
  assert.equal(week[0].label, "Scheduled shift");
  assert.equal(week[1].state, "unassigned");
  assert.equal(week[1].label, "No published shift");
});

test("rest days and approved changes are shown without interpreting attendance or pay", () => {
  const week = upcomingSevenDays([
    day("2026-10-10", { isRestDay: true, segments: [] }),
    day("2026-10-11", { source: "override", segments: [night] }),
    day("2026-10-12", { source: "override", isRestDay: true, segments: [] }),
  ], "2026-10-10");
  assert.equal(week[0].state, "rest");
  assert.equal(week[1].changed, true);
  assert.match(week[1].segments[0], /\(\+1 day\)/);
  assert.equal(week[2].changed, true);
  assert.equal(week[2].state, "rest");
  const summary = summarizeUpcomingWeek(week);
  assert.deepEqual(summary, { scheduled: 1, changes: 2, restDays: 2, needsReview: 4 });
});

test("invalid and duplicate schedule evidence is never shown as a confirmed shift", () => {
  const week = upcomingSevenDays([
    day("2026-10-10", { segments: [{ ...shift, startTime: "25:00" }] }),
    day("2026-10-11"),
    day("2026-10-11", { source: "override" }),
    day("2026-10-12", { source: "pattern", segments: [] }),
    day("2026-10-13", { source: "unassigned", segments: [shift] }),
    day("2026-02-30"),
  ], "2026-10-10");
  assert.deepEqual(week.slice(0, 4).map(d => d.state), ["review", "review", "review", "unassigned"]);
  assert.equal(week[3].changed, false);
  assert.ok(week.every(d => !d.label.includes("Absent") && !d.label.includes("Deduct")));
  assert.throws(() => upcomingSevenDays([], "2026-02-30"), /valid ISO/);
});

test("Manila date respects UTC date boundary rather than device or server timezone", () => {
  assert.equal(manilaWorkDate(new Date("2026-10-09T16:00:00Z")), "2026-10-10");
  assert.equal(manilaWorkDate(new Date("2026-10-09T15:59:59Z")), "2026-10-09");
  assert.equal(manilaWorkDate(new Date("2024-02-29T18:00:00Z")), "2024-03-01");
  const leap = upcomingSevenDays([], "2024-02-27");
  assert.equal(leap[2].date, "2024-02-29");
  assert.equal(leap[6].date, "2024-03-04");
});

test("ESS upcoming-week UI only renders session-scoped source and never posts schedule/payroll changes", () => {
  const panel = readFileSync("src/components/employee-workforce-panel.tsx", "utf8");
  const route = readFileSync("src/app/api/self/workforce/route.ts", "utf8");
  assert.ok(panel.includes('fetch("/api/self/workforce"'));
  assert.ok(panel.includes("data-employee-upcoming-week"));
  assert.ok(panel.includes("upcomingSevenDays(payload?.schedule"));
  assert.ok(panel.includes("A missing roster entry is not an absence or a payroll deduction."));
  assert.ok(!panel.includes("action: \"publish_shift\""));
  assert.ok(!panel.includes("action: \"approve_override\""));
  assert.ok(route.includes("session.employeeId"));
  assert.ok(route.includes("assertMembership(session.id, employee.organizationId)"));
});
