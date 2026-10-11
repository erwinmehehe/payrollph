import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { philippineClockDate, philippineClockTime } from "../src/lib/philippine-clock-display";

test("Web Bundy clock rolls over on Manila date, not on the browser's UTC date", () => {
  const beforeMidnight = new Date("2026-10-10T15:59:59.000Z");
  const afterMidnight = new Date("2026-10-10T16:00:00.000Z");

  assert.match(philippineClockTime(beforeMidnight), /11:59:59\s*PM/i);
  assert.match(philippineClockTime(afterMidnight), /12:00:00\s*AM/i);
  assert.match(philippineClockDate(beforeMidnight), /Saturday.*October\s+10.*2026/);
  assert.match(philippineClockDate(afterMidnight), /Sunday.*October\s+11.*2026/);

  // Date formatting must not mutate the payroll punch instant.
  assert.equal(beforeMidnight.toISOString(), "2026-10-10T15:59:59.000Z");
  assert.equal(afterMidnight.toISOString(), "2026-10-10T16:00:00.000Z");
});

test("Manila display ignores the device timezone, including browsers west of UTC", () => {
  const punch = new Date("2026-10-10T17:30:23.000Z");
  const expectedTime = philippineClockTime(punch);
  const expectedDate = philippineClockDate(punch);
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      assert.equal(philippineClockTime(punch), expectedTime, zone);
      assert.equal(philippineClockDate(punch), expectedDate, zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("Web Bundy presents every stored punch in Manila time without rewriting API timestamps", () => {
  const modal = readFileSync("src/components/web-bundy-modal.tsx", "utf8");
  const server = readFileSync("src/app/api/web-bundy/route.ts", "utf8");
  assert.match(modal, /setTime\(philippineClockTime\(now\)\)/);
  assert.match(modal, /setDate\(philippineClockDate\(now\)\)/);
  assert.match(modal, /philippineClockTime\(new Date\(todayPunch\.timeIn\)\)/);
  assert.match(modal, /philippineClockTime\(new Date\(todayPunch\.timeOut\)\)/);
  assert.match(modal, /philippineClockTime\(new Date\(todayPunch\.breakStart\)\)/);
  assert.match(modal, /philippineClockTime\(new Date\(todayPunch\.breakEnd\)\)/);
  assert.match(modal, /Philippine Standard Time \(PST · UTC\+8\)/);
  assert.match(server, /const now = new Date\(\)/);
  assert.match(server, /now\.toISOString\(\)/);
  assert.doesNotMatch(modal, /new Date\(todayPunch\.(?:timeIn|timeOut|breakStart|breakEnd)\)\.toLocaleTimeString/);
});
