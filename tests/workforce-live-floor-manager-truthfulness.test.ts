import assert from "node:assert/strict";
import test from "node:test";
import { classifyFloorSegment } from "../src/lib/workforce-live-floor";

const segment = {
  shiftDefinitionId: 1, shiftCode: "DAY", shiftName: "Fictional day shift",
  segmentOrder: 1, startTime: "09:00", endTime: "17:00", breakMinutes: 60, spansMidnight: false,
};
const worker = { id: 11, employeeNo: "TEST-011", name: "Fictional Worker", status: "Active" };
const base = {
  employee: worker, workDate: "2026-11-02", worksiteId: 1, segment,
  punches: [], leave: "none" as const,
};

test("manager Live Floor shows unconfirmed check-in, not an unsupported absence finding", () => {
  const beforeGrace = classifyFloorSegment({ ...base, now: new Date("2026-11-02T09:07:00+08:00") });
  assert.equal(beforeGrace.status, "check_in_window");
  const late = classifyFloorSegment({ ...base, now: new Date("2026-11-02T10:30:00+08:00") });
  assert.equal(late.status, "clock_in_unconfirmed");
  assert.match(late.explanation, /Not an absence finding/);
  const ended = classifyFloorSegment({ ...base, now: new Date("2026-11-02T18:00:00+08:00") });
  assert.equal(ended.status, "missing_punch_review");
  assert.match(ended.explanation, /not an absence finding/i);
});

test("approved full-day leave and uncertain leave remain distinct from absence", () => {
  const now = new Date("2026-11-02T10:30:00+08:00");
  assert.equal(classifyFloorSegment({ ...base, now, leave: "full" }).status, "approved_leave");
  assert.equal(classifyFloorSegment({ ...base, now, leave: "partial_or_uncertain" }).status, "leave_timing_review");
});

test("recorded clock-in does not claim verified physical presence", () => {
  const result = classifyFloorSegment({
    ...base, now: new Date("2026-11-02T10:30:00+08:00"),
    punches: [{ id: 1, timeIn: "2026-11-02T09:35:00+08:00", timeOut: null }],
  });
  assert.equal(result.status, "clocked_in");
  assert.match(result.explanation, /not independently verified/i);
});
