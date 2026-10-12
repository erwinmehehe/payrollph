import assert from "node:assert/strict";
import test from "node:test";
import {
  scanClockWatchAssignments,
  type ClockWatchAssignmentRef,
} from "../src/lib/workforce-clock-in-watch-paging";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

function fixture(size: number): ClockWatchAssignmentRef[] {
  return Array.from({ length: size }, (_, n) => ({
    id: n + 1,
    organizationId: n % 2 ? 7 : 8,
    employeeId: n + 101,
  }));
}

test("WFM-12 keyset scan reads all 1,000 assignments without false coverage", async () => {
  const data = fixture(1_000);
  const cursors: number[] = [];
  const result = await scanClockWatchAssignments(async (after, limit) => {
    cursors.push(after);
    return data.filter(row => row.id > after).slice(0, limit);
  }, { pageSize: 128, scanLimit: 1_500 });
  assert.equal(result.complete, true);
  assert.equal(result.assignments.length, 1_000);
  assert.deepEqual(result.assignments.map(row => row.id), data.map(row => row.id));
  assert.deepEqual(cursors, [0, 128, 256, 384, 512, 640, 768, 896]);
});

test("a cap breach discards the entire cohort rather than returning a partial roster", async () => {
  const data = fixture(1_001);
  const result = await scanClockWatchAssignments(async (after, limit) =>
    data.filter(row => row.id > after).slice(0, limit),
  { pageSize: 200, scanLimit: 1_000 });
  assert.deepEqual(result, {
    complete: false, assignments: [], pages: 6, limit: 1_000,
  });
});

test("a duplicated or regressing cursor fails closed", async () => {
  await assert.rejects(
    scanClockWatchAssignments(async () => [
      { id: 10, organizationId: 1, employeeId: 1 },
      { id: 10, organizationId: 1, employeeId: 2 },
    ], { pageSize: 5 }),
    /strictly ordered/,
  );
});

test("missing and incorrectly cased WFM paging flag remain disabled", () => {
  assert.equal(criticalReleaseFlagEnabled("wfmClockWatchPaging", {}), false);
  assert.equal(criticalReleaseFlagEnabled("wfmClockWatchPaging", {
    WFM_CLOCK_WATCH_PAGING_ENABLED: "TRUE",
  }), false);
  assert.equal(criticalReleaseFlagEnabled("wfmClockWatchPaging", {
    WFM_CLOCK_WATCH_PAGING_ENABLED: "true",
  }), true);
});
