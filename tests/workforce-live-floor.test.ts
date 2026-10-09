import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFloorSegment, floorSegmentBounds, floorNeedsReview, summarizeFloor,
} from "../src/lib/workforce-live-floor";
import type { ResolvedScheduleSegment } from "../src/lib/workforce-scheduling";

const day: ResolvedScheduleSegment = {
  shiftDefinitionId: 1, shiftCode: "DAY", shiftName: "Day shift",
  startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  spansMidnight: false, segmentOrder: 1,
};
const night: ResolvedScheduleSegment = {
  ...day, shiftCode: "NIGHT", shiftName: "Night shift",
  startTime: "22:00", endTime: "06:00", spansMidnight: true,
};
const employee = { id: 3, employeeNo: "EMP-003", name: "Synthetic Worker", status: "Active" };
function sample(instant: string, overrides: Partial<Parameters<typeof classifyFloorSegment>[0]> = {}) {
  return classifyFloorSegment({
    now: new Date(instant), employee, workDate: "2026-10-09",
    worksiteId: 2, segment: day, punches: [], leave: "none", ...overrides,
  });
}

test("live floor anchors Philippine overnight shift to original workDate", () => {
  const bounds = floorSegmentBounds("2026-10-09", night);
  assert.equal(new Date(bounds.start).toISOString(), "2026-10-09T14:00:00.000Z");
  assert.equal(new Date(bounds.end).toISOString(), "2026-10-09T22:00:00.000Z");
  const row = sample("2026-10-09T18:00:00Z", { segment: night });
  assert.equal(row.status, "clock_in_unconfirmed");
  assert.equal(row.workDate, "2026-10-09");
  assert.equal(row.endsAt, "2026-10-09T22:00:00.000Z");
});

test("live floor never labels an unconfirmed punch as absence", () => {
  assert.equal(sample("2026-10-09T01:10:00Z").status, "check_in_window");
  const late = sample("2026-10-09T01:16:00Z");
  assert.equal(late.status, "clock_in_unconfirmed");
  assert.match(late.explanation, /Not an absence finding/);
  assert.equal(sample("2026-10-09T11:15:00Z").status, "missing_punch_review");
  assert.equal(sample("2026-10-09T00:00:00Z").status, "upcoming");
});

test("floor arrival evidence identifies in, break and recorded out without claiming physical presence", () => {
  const basic = { id: 1, timeIn: "2026-10-09T00:58:00Z", timeOut: null };
  assert.equal(sample("2026-10-09T02:00:00Z", { punches: [basic] }).status, "clocked_in");
  assert.equal(sample("2026-10-09T03:00:00Z", {
    punches: [{ ...basic, breakStart: "2026-10-09T02:00:00Z" }],
  }).status, "break_recorded");
  assert.equal(sample("2026-10-09T10:10:00Z", {
    punches: [{ ...basic, timeOut: "2026-10-09T10:00:00Z" }],
  }).status, "clocked_out");
});

test("full approved leave is not a missing-punch alert and its conflicting punch is reviewed", () => {
  assert.equal(sample("2026-10-09T04:00:00Z", { leave: "full" }).status, "approved_leave");
  assert.equal(sample("2026-10-09T04:00:00Z", { leave: "partial_or_uncertain" }).status, "leave_timing_review");
  assert.equal(sample("2026-10-09T04:00:00Z", {
    leave: "full", punches: [{ id: 2, timeIn: "2026-10-09T01:00:00Z", timeOut: null }],
  }).status, "leave_punch_review");
});

test("malformed, future and duplicate open punches fail closed", () => {
  const malformed = { id: 1, timeIn: null, timeOut: "2026-10-09T01:00:00Z" };
  assert.equal(sample("2026-10-09T04:00:00Z", { punches: [malformed] }).status, "punch_evidence_review");
  assert.equal(sample("2026-10-09T04:00:00Z", {
    punches: [{ id: 2, timeIn: "2026-10-09T08:00:00Z", timeOut: null }],
  }).status, "punch_evidence_review");
  assert.equal(sample("2026-10-09T04:00:00Z", {
    punches: [
      { id: 3, timeIn: "2026-10-09T01:00:00Z", timeOut: null },
      { id: 4, timeIn: "2026-10-09T02:00:00Z", timeOut: null },
    ],
  }).status, "punch_evidence_review");
});

test("old open time-in is evidence review, not proof of current onsite status", () => {
  assert.equal(sample("2026-10-09T15:00:00Z", {
    punches: [{ id: 1, timeIn: "2026-10-09T01:00:00Z", timeOut: null }],
  }).status, "punch_evidence_review");
  assert.equal(sample("2026-10-09T04:00:00Z", {
    employee: { ...employee, status: "Separated" },
  }).status, "employment_review");
});

test("split shifts do not reuse one punch for a distant second segment", () => {
  const second = { ...day, segmentOrder: 2, startTime: "16:00", endTime: "20:00" };
  const punched = { id: 1, timeIn: "2026-10-09T01:00:00Z", timeOut: "2026-10-09T04:00:00Z" };
  assert.equal(sample("2026-10-09T07:00:00Z", { segment: second, punches: [punched] }).status, "upcoming");
  assert.equal(sample("2026-10-09T10:00:00Z", { segment: second, punches: [punched] }).status, "clock_in_unconfirmed");
  const earlyInAndOut = { id: 5, timeIn: "2026-10-09T06:30:00Z", timeOut: "2026-10-09T07:15:00Z" };
  assert.equal(sample("2026-10-09T10:00:00Z", { segment: second, punches: [earlyInAndOut] }).status, "clock_in_unconfirmed");
});

test("invalid schedule clocks and nonexistent dates cannot produce fake floor status", () => {
  assert.throws(() => floorSegmentBounds("2026-02-30", day), /Invalid schedule calendar date/);
  assert.throws(() => floorSegmentBounds("2026-10-09", { ...day, startTime: "25:00" }), /Invalid Philippine schedule date or clock/);
  assert.throws(() => sample("not-a-date"), /Live-floor clock/);
});

test("summary distinguishes review signals from recorded time", () => {
  const rows = [
    sample("2026-10-09T01:16:00Z"),
    sample("2026-10-09T04:00:00Z", { leave: "full" }),
    sample("2026-10-09T03:00:00Z", {
      punches: [{ id: 1, timeIn: "2026-10-09T01:00:00Z", timeOut: null }],
    }),
  ];
  const summary = summarizeFloor(rows);
  assert.equal(summary.requiresReview, 1);
  assert.equal(summary.recordedIn, 1);
  assert.equal(summary.approvedLeave, 1);
  assert.equal(summary.shiftSegments, 3);
  assert.ok(floorNeedsReview(rows[0].status));
  assert.ok(!floorNeedsReview(rows[2].status));
});
