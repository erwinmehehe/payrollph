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
      previousShiftNeedsReview: false,
    });
  }
  assert.deepEqual(resolve("clock_in"), {
    workDate: today, usePrevious: false, previousOpenRequiresClose: true,
    previousShiftNeedsReview: false,
  });
});

test("ambiguous new-day source and foreign source never silently attach to old day", () => {
  const current = { ...previous, workDate: today, timeIn: at };
  assert.equal(resolve("clock_out", { todayPunch: current }).previousShiftNeedsReview, true,
    "Two open shifts from consecutive days must not silently choose today's punch.");
  assert.equal(resolve("clock_out", { todayPunch: current }).usePrevious, false);
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, source: "biometric" } }).previousShiftNeedsReview, true);
  assert.equal(resolve("clock_in", { previousPunch: { ...previous, source: "biometric" } }).previousShiftNeedsReview, true);
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, timeOut: at } }).previousShiftNeedsReview, false);
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, workDate: "2026-10-10" } }).usePrevious, false);
  assert.equal(resolve("clock_out", {
    previousPunch: { ...previous, timeIn: new Date("2026-10-12T00:10:00+08:00") },
  }).previousShiftNeedsReview, true, "Previous workDate with today's clock-in is never inferred.");
});

test("clock drift and shifts beyond 18 hours require correction, not overnight auto-close", () => {
  assert.equal(resolve("clock_out", { previousPunch: { ...previous, timeIn: new Date(at.getTime() + 1000) } }).previousShiftNeedsReview, true);
  const tooOld = { ...previous, timeIn: new Date(at.getTime() - 19 * 3600 * 1000) };
  assert.equal(resolve("clock_out", { previousPunch: tooOld }).usePrevious, false);
  assert.equal(resolve("clock_out", { previousPunch: tooOld }).previousShiftNeedsReview, true);
  assert.equal(resolve("clock_in", { previousPunch: tooOld }).previousShiftNeedsReview, true,
    "Stale previous-day punch must not allow silently starting a new shift.");
  assert.equal(resolve("clock_in", { previousPunch: tooOld }).previousOpenRequiresClose, false);
});

test("server keeps both effective work-date and present-day payroll cutoff locks", () => {
  const route = readFileSync("src/app/api/web-bundy/route.ts", "utf8");
  assert.match(route, /resolveWebBundyPunchAnchor/);
  assert.match(route, /previousOpenRequiresClose/);
  assert.match(route, /previousShiftNeedsReview/);
  assert.match(route, /ATTENDANCE_REQUIRES_REVIEW/);
  assert.match(route, /attendanceMutationLock\(locks, effectiveWorkDate, "capture"\)/);
  assert.match(route, /attendanceMutationLock\(locks, todayStr, "capture"\)/);
  assert.match(route, /authorizedGeofenceSites\(organizationId, employeeId, effectiveWorkDate\)/);
  assert.match(route, /workDate: effectiveWorkDate/);
});
