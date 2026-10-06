import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Leave page offers precise timing modes and schedule preview", () => {
  const panels = read("src/components/workspace/panels.tsx");
  assert.ok(panels.includes("Full day"));
  assert.ok(panels.includes("First half"));
  assert.ok(panels.includes("Second half"));
  assert.ok(panels.includes("Custom hours"));
  assert.ok(panels.includes("/api/leave/preview"));
  assert.ok(panels.includes("startLocalTime"));
  assert.ok(panels.includes("endLocalTime"));
  assert.ok(panels.includes("Preview schedule impact"));
  assert.ok(panels.includes("Legacy timing not specified"));
});

test("Dashboard leave rows expose current precise interval evidence", () => {
  const dashboard = read("src/lib/dashboard-data.ts");
  const types = read("src/components/workspace/types.ts");
  assert.ok(dashboard.includes("leaveRequestIntervalSets"));
  assert.ok(dashboard.includes("leaveRequestIntervals"));
  assert.ok(types.includes("intervalRevision"));
  assert.ok(types.includes("intervals?:"));
});


test("custom-hour leave requires explicit overnight selection instead of inferring it from clock order", () => {
  const panels = read("src/components/workspace/panels.tsx");
  assert.ok(panels.includes("Ends next day"));
  assert.ok(panels.includes("timedEndsNextDay"));
  assert.ok(!panels.includes("endLocalTime <= startLocalTime"));
});
