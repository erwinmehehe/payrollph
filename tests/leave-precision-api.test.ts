import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("precise leave exposes a schedule-aware preview route", () => {
  assert.equal(existsSync("src/app/api/leave/preview/route.ts"), true);
  if (!existsSync("src/app/api/leave/preview/route.ts")) return;
  const route = read("src/app/api/leave/preview/route.ts");
  assert.ok(route.includes("loadResolvedEmployeeSchedule"));
  assert.ok(route.includes("resolveLeaveIntervalsForSchedule"));
  assert.ok(route.includes("enforceSameOriginMutation"));
  assert.ok(route.includes("assertScope"));
});

test("leave submission persists current precise interval evidence", () => {
  const route = read("src/app/api/leave/route.ts");
  assert.ok(route.includes("leaveRequestIntervalSets"));
  assert.ok(route.includes("leaveRequestIntervals"));
  assert.ok(route.includes("validateLeaveIntervals"));
  assert.ok(route.includes("intervals"));
  assert.ok(route.includes("revision: 1"));
});

test("new partial leave fails closed without precise timing", () => {
  const route = read("src/app/api/leave/route.ts");
  assert.ok(route.includes("Precise timing is required for partial-day leave"));
  assert.ok(route.includes("approvedLeaveCoverageImpact"));
});

test("leave API returns interval evidence for register display", () => {
  const route = read("src/app/api/leave/route.ts");
  assert.ok(route.includes("intervalSet"));
  assert.ok(route.includes("intervals:"));
});

test("leave interval revisions preserve old evidence and stale timesheets", () => {
  const route = read("src/app/api/leave/route.ts");
  assert.ok(route.includes('action === "revise_intervals"'));
  assert.ok(route.includes('status: "superseded"'));
  assert.ok(route.includes("markTimesheetsStaleForEmployeeRange"));
  assert.ok(route.includes("nextRevision"));
});

test("approval evidence includes the approved interval revision", () => {
  const approvals = read("src/app/api/approvals/[id]/route.ts");
  assert.ok(approvals.includes("leaveRequestIntervalSets"));
  assert.ok(approvals.includes("intervalRevision"));
});
