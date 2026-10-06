import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("timesheet snapshots carry approved precise leave revision evidence", () => {
  const server = read("src/lib/workforce-timesheet-server.ts");
  assert.ok(server.includes("leaveRequestIntervalSets"));
  assert.ok(server.includes("leaveRequestIntervals"));
  assert.ok(server.includes("preciseLeave"));
  assert.ok(server.includes("intervalRevision"));
  assert.ok(server.includes("leaveWorkOverlap"));
});

test("precise leave overlap with actual punches becomes review evidence, not punch deletion", () => {
  const server = read("src/lib/workforce-timesheet-server.ts");
  assert.ok(server.includes("Approved leave overlaps recorded work"));
  assert.ok(server.includes("clock_integrity"));
  assert.ok(!server.includes("delete(timePunches)"));
});
