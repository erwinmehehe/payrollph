import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  previousManilaWorkDate, eligiblePreviousWebBundyPunch,
  resolveWebBundyPunchAnchor,
} from "../src/lib/web-bundy-overnight-anchor";

const at = new Date("2026-10-12T00:20:00+08:00");
const today = "2026-10-12";
const previous = {
  workDate: "2026-10-11", source: "web_bundy",
  timeIn: new Date("2026-10-11T22:15:00+08:00"), timeOut: null,
};
const resolve = (action: "clock_in" | "break_start" | "break_end" | "clock_out", data = {}) =>
  resolveWebBundyPunchAnchor({
    today, now: at, todayPunch: null, previousPunch: previous, action, ...data,
  });

test("Manila prior day handles leap year and year/month rollover", () => {
  assert.equal(previousManilaWorkDate("2027-01-01"), "2026-12-31");
  assert.equal(previousManilaWorkDate("2024-03-01"), "2024-02-29");
  assert.throws(() => previousManilaWorkDate("2026-02-31"));
});

test("overnight IN/out and break stay on the original workDate after midnight", () => {
  assert.equal(eligiblePreviousWebBundyPunch(previous, today, at), true);
  for (const action of ["break_start", "break_end", "clock_out"] as const) {
    assert.deepEqual(resolve(action), {
      workDate: "2026-10-11", usePrevious: true, previousOpenRequiresClose: false,
    });
  }
  assert.deepEqual(resolve("clock_in"), {
    workDate: today, usePrevious: false, previousOpenRequiresClose: true,
  });
});

test("ambiguous new-day source and foreign source never silently attach to old day", () => {
  const current = { ...previous, workDate: today, timeIn: at };
  assert.equal(resolve("clock_out", { todayPunch: current }).usePrevious, false);
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, source: "biometric" } }).usePrevious, false);
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, timeOut: at } }).usePrevious, false);
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, workDate: "2026-10-10" } }).usePrevious, false);
});

test("clock drift and shifts beyond 18 hours require correction, not overnight auto-close", () => {
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, timeIn: new Date(at.getTime() + 1000) } }).usePrevious, false);
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, timeIn: new Date(at.getTime() - 19 * 3600 * 1000) } }).usePrevious, false);
  assert.equal(resolve("clock_in", { previousPunch: { ...previous, timeIn: new Date(at.getTime() - 19 * 3600 * 1000) } }).previousOpenRequiresClose, false);
});

test("server keeps both effective work-date and present-day payroll cutoff locks", () => {
  const route = readFileSync("src/app/api/web-bundy/route.ts", "utf8");
  assert.match(route, /resolveWebBundyPunchAnchor/);
  assert.match(route, /previousOpenRequiresClose/);
  assert.match(route, /attendanceMutationLock\(locks, effectiveWorkDate, "capture"\)/);
  assert.match(route, /attendanceMutationLock\(locks, todayStr, "capture"\)/);
  assert.match(route, /authorizedGeofenceSites\(organizationId, employeeId, effectiveWorkDate\)/);
  assert.match(route, /workDate: effectiveWorkDate/);
});
