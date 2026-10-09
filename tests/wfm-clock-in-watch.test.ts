import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { clockInWatchSignals, type ClockInWatchCandidate } from "../src/lib/workforce-clock-in-watch";
import type { ResolvedDailySchedule } from "../src/lib/workforce-scheduling";

const day = "2026-10-09";
const shift = {
  shiftDefinitionId: 18,
  shiftCode: "MORNING",
  shiftName: "Morning shift",
  segmentOrder: 1,
  startTime: "09:00",
  endTime: "18:00",
  breakMinutes: 60,
  spansMidnight: false,
};
const schedule: ResolvedDailySchedule = {
  date: day,
  source: "pattern",
  isRestDay: false,
  assignmentId: 5,
  patternId: 2,
  patternDayIndex: 4,
  overrideId: null,
  workLocationOrgUnitId: 7,
  worksiteId: 3,
  segments: [shift],
  audit: [],
};
const person: ClockInWatchCandidate = {
  organizationId: 34,
  employeeId: 88,
  employeeStatus: "Active",
  employmentStartDate: "2026-01-01",
  schedule,
  punches: [],
  approvedLeaveOnDate: false,
  conflictingSeparation: false,
};
function watch(input: Partial<ClockInWatchCandidate> = {}, now = "2026-10-09T01:30:00Z", graceMinutes = 20) {
  return clockInWatchSignals({ candidate: { ...person, ...input }, now: new Date(now), graceMinutes });
}
test("scheduled worker without confirmed check-in creates one deterministic advisory event", () => {
  const [signal] = watch();
  assert.ok(signal);
  assert.equal(watch().length, 1);
  assert.equal(signal.minutesSinceShiftStart, 30);
  assert.equal(signal.shiftStartTime, "09:00");
  assert.equal(signal.worksiteId, 3);
  assert.equal(signal.eventKey, watch()[0].eventKey);
  assert.match(signal.eventKey, /wfm-clock-in-watch-v1:34:88:2026-10-09/);
});
test("grace period and watch window prevent premature and stale warnings", () => {
  assert.equal(watch({}, "2026-10-09T01:19:00Z").length, 0);
  assert.equal(watch({}, "2026-10-09T01:20:00Z").length, 1);
  assert.equal(watch({}, "2026-10-09T04:01:00Z").length, 0);
  assert.equal(watch({}, "2026-10-09T01:30:00Z", 2).length, 0);
  assert.equal(watch({}, "2026-10-09T01:30:00Z", 100).length, 0);
  assert.equal(watch({}, "invalid-date").length, 0);
});
test("a real punch is enough to suppress allegation, including an early punch", () => {
  assert.equal(watch({ punches: [{
    timeIn: "2026-10-09T00:10:00Z", timeOut: null,
  }] }).length, 0);
  assert.equal(watch({ punches: [{ timeIn: "invalid", timeOut: null }] }).length, 0);
  assert.equal(watch({ punches: [{ timeIn: null, timeOut: null }] }).length, 0);
});
test("approved leave, conflicting exit, rest day and missing schedules never alert", () => {
  assert.equal(watch({ approvedLeaveOnDate: true }).length, 0);
  assert.equal(watch({ conflictingSeparation: true }).length, 0);
  assert.equal(watch({ employeeStatus: "Separated" }).length, 0);
  assert.equal(watch({ employmentStartDate: "2026-10-10" }).length, 0);
  assert.equal(watch({ schedule: { ...schedule, isRestDay: true } }).length, 0);
  assert.equal(watch({ schedule: { ...schedule, source: "unassigned" } }).length, 0);
});
test("overnight shift can still receive a review after Philippine midnight", () => {
  const night = {
    ...schedule, date: "2026-10-08",
    segments: [{ ...shift, startTime: "23:00", endTime: "03:00", spansMidnight: true }],
  };
  const a = watch({ schedule: night }, "2026-10-08T16:00:00Z");
  assert.equal(a.length, 1);
  assert.equal(a[0].workDate, "2026-10-08");
  assert.equal(a[0].minutesSinceShiftStart, 60);
});
test("multi-segment work does not reuse a completed earlier clock-in as second-shift evidence", () => {
  const split = { ...schedule, segments: [
    { ...shift, startTime: "08:00", endTime: "11:00" },
    { ...shift, segmentOrder: 2, shiftDefinitionId: 19, shiftName: "Afternoon", startTime: "14:00", endTime: "18:00" },
  ] };
  const earlierPunch = { timeIn: "2026-10-09T00:00:00Z", timeOut: "2026-10-09T03:00:00Z" };
  const a = watch({ schedule: split, punches: [earlierPunch] }, "2026-10-09T06:30:00Z");
  assert.equal(a.length, 1);
  assert.equal(a[0].shiftDefinitionId, 19);
  assert.equal(watch({ schedule: split, punches: [{ ...earlierPunch, timeOut: null }] },
    "2026-10-09T06:30:00Z").length, 0);
});
test("malformed or contradictory shift clocks do not produce attendance accusations", () => {
  assert.equal(watch({ schedule: { ...schedule,
    segments: [{ ...shift, startTime: "25:00" }] } }).length, 0);
  assert.equal(watch({ schedule: { ...schedule, date: "2026-02-30" } }).length, 0);
  assert.equal(watch({ schedule: { ...schedule,
    segments: [{ ...shift, endTime: "08:00", spansMidnight: false }] } }).length, 0);
});
test("runtime automation is off unless explicitly enabled and routes through governed events", () => {
  const temporal = readFileSync("src/lib/automation-temporal-events.ts", "utf8");
  const service = readFileSync("src/lib/workforce-clock-in-watch-server.ts", "utf8");
  const engine = readFileSync("src/lib/automation.ts", "utf8");
  const templates = readFileSync("src/lib/automation-templates.ts", "utf8");
  assert.match(temporal, /WFM_CLOCK_IN_WATCH_ENABLED === "true"/);
  assert.match(service, /runAutomationEventSafely\(/);
  assert.match(service, /resolveEmployeeScheduleWindow\(/);
  assert.match(service, /cohort-too-large/);
  assert.match(service, /Approved/);
  assert.ok(engine.includes('"attendance.clock_in_pending"'));
  assert.ok(templates.includes('id: "workforce-clock-in-pending-manager-review"'));
  assert.doesNotMatch(service, /payrollRuns|payrollEngine|bankTransfers/);
});
