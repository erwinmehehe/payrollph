import assert from "node:assert/strict";
import test from "node:test";
import {
  attendancePunchSnapshot,
  attendancePunchSnapshotsMatch,
  normalizeAttendanceCorrection,
  punchStatusAfterCorrection,
} from "../src/lib/workforce-attendance-correction";

const original = attendancePunchSnapshot({
  workDate: "2026-10-05",
  timeIn: "2026-10-05T08:02:00+08:00",
  timeOut: "2026-10-05T17:05:00+08:00",
  breakStart: "2026-10-05T12:00:00+08:00",
  breakEnd: "2026-10-05T13:00:00+08:00",
  status: "Complete",
});

test("attendance correction snapshots normalize absolute timestamps", () => {
  assert.deepEqual(original, {
    workDate: "2026-10-05",
    timeIn: "2026-10-05T00:02:00.000Z",
    timeOut: "2026-10-05T09:05:00.000Z",
    breakStart: "2026-10-05T04:00:00.000Z",
    breakEnd: "2026-10-05T05:00:00.000Z",
    status: "Complete",
  });
});

test("correction preserves omitted fields and changes only proposed timestamps", () => {
  const proposed = normalizeAttendanceCorrection({
    original,
    proposedTimeIn: "2026-10-05T08:00:00+08:00",
  });

  assert.equal(proposed.timeIn, "2026-10-05T00:00:00.000Z");
  assert.equal(proposed.timeOut, original.timeOut);
  assert.equal(proposed.breakStart, original.breakStart);
  assert.equal(proposed.breakEnd, original.breakEnd);
  assert.equal(attendancePunchSnapshotsMatch(original, proposed), false);
});

test("correction rejects no-op edits", () => {
  assert.throws(
    () => normalizeAttendanceCorrection({ original }),
    /must change at least one/i,
  );
});

test("correction rejects invalid time and break order", () => {
  assert.throws(
    () => normalizeAttendanceCorrection({
      original,
      proposedTimeOut: "2026-10-05T07:00:00+08:00",
    }),
    /time out must be later/i,
  );

  assert.throws(
    () => normalizeAttendanceCorrection({
      original,
      proposedBreakStart: "2026-10-05T14:00:00+08:00",
      proposedBreakEnd: "2026-10-05T13:00:00+08:00",
    }),
    /break end must be later/i,
  );
});

test("approved correction status is explicit instead of pretending to be a raw capture", () => {
  assert.equal(punchStatusAfterCorrection(original), "Corrected");
  assert.equal(
    punchStatusAfterCorrection({ ...original, timeOut: null }),
    "Incomplete",
  );
});
