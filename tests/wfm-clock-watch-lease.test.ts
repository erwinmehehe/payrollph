import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clockWatchLeaseFence, ClockWatchLeaseLostError } from "../src/lib/workforce-clock-watch-lease";
import { scanClockWatchAssignments } from "../src/lib/workforce-clock-in-watch-paging";

test("a clock-watch attempt latches a failed lease and never retries or exposes its cause", async () => {
  let calls = 0;
  const fence = clockWatchLeaseFence(async () => {
    if (++calls === 2) throw Error("private driver token must not escape");
  });
  await fence();
  await assert.rejects(fence(), error => error instanceof ClockWatchLeaseLostError && !error.message.includes("private"));
  await assert.rejects(fence(), ClockWatchLeaseLostError);
  assert.equal(calls, 2, "a recovered probe must not revive the lost attempt");
});

test("a missing lease authority cannot authorize standalone watch work", async () => {
  const fence = clockWatchLeaseFence(undefined as unknown as () => Promise<void>);
  await assert.rejects(fence(), ClockWatchLeaseLostError);
});

test("loss before page two abandons a 1000-assignment scan before any partial cohort can be used", async () => {
  let probes = 0, reads = 0, emitted = 0;
  const fence = clockWatchLeaseFence(async () => { if (++probes === 2) throw Error("lease replaced"); });
  await assert.rejects(async () => {
    const result = await scanClockWatchAssignments(async (after, limit) => {
      await fence(); reads++;
      return Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, organizationId: 1, employeeId: i + 1 }))
        .filter(row => row.id > after).slice(0, limit);
    });
    emitted = result.assignments.length;
  }, ClockWatchLeaseLostError);
  assert.equal(reads, 1); assert.equal(emitted, 0);
});

test("both watch lanes receive the central authority and lease loss escapes optional monitor isolation", () => {
  const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
  const temporal = readFileSync("src/lib/automation-temporal-events.ts", "utf8");
  assert.match(scheduler, /runScheduledAutomationTemporalEvents\(\{ now, assertLeaseOwnership \}\)/);
  assert.match(scheduler, /if \(error instanceof ClockWatchLeaseLostError\) throw error;/);
  assert.match(temporal, /options\.assertLeaseOwnership,\s*\)\.catch/);
  assert.match(temporal, /if \(error instanceof ClockWatchLeaseLostError\) throw error;/);
  assert.match(temporal, /await options\.assertLeaseOwnership\(\);\s*await db\.insert\(schedulerState\)/);
  for (const file of ["workforce-clock-in-watch-server", "workforce-roster-clock-in-watch-server"]) {
    const source = readFileSync("src/lib/" + file + ".ts", "utf8");
    assert.match(source, /await assertActiveLease\(\);\s*await runAutomationEventSafely\(/);
  }
});
