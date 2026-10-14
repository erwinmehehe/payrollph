import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { manilaCalendarDate } from "../src/lib/payroll-period-ui";

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

test("new HR leave forms use the current Asia/Manila calendar day, including UTC boundary", () => {
  assert.equal(manilaCalendarDate(new Date("2026-10-13T15:59:59Z")), "2026-10-13");
  assert.equal(manilaCalendarDate(new Date("2026-10-13T16:00:00Z")), "2026-10-14");
  const panels = read("src/components/workspace/panels.tsx");
  assert.ok(panels.includes("const today = manilaCalendarDate();"));
  assert.ok(panels.includes("onClick={toggleLeaveRequest}"));
  assert.ok(!panels.includes('"2026-03-24"'), "Old hardcoded date must not reappear");
  assert.match(panels, /setStartDate\(today\);\s*setEndDate\(today\);/);
});

test("partial-day leave preview cannot authorize a changed or obsolete request", () => {
  const panels = read("src/components/workspace/panels.tsx");
  assert.ok(panels.includes("timingPreview?.signature === previewSignature"));
  assert.ok(panels.includes("generation !== previewGeneration.current"));
  assert.ok(panels.includes("generation === previewGeneration.current"));
  assert.ok(panels.includes("!currentTimingPreview || currentTimingPreview.blocking"));
  assert.ok(panels.includes("setTimingPreview({ ...payload, signature })"));
  assert.ok(panels.includes("if (mode === \"full_day\" && days === 0.5) setDays(1);"));
  for (const input of ["setEmployeeId(Number(event.target.value))", "setLeaveType(event.target.value)",
    "setStartDate(event.target.value)", "setEndDate(event.target.value)",
    "setDays(Number(event.target.value))", "setStartLocalTime(event.target.value)",
    "setEndLocalTime(event.target.value)", "setTimedEndsNextDay(event.target.checked)"]) {
    const offset = panels.indexOf(input);
    assert.ok(offset !== -1, "Missing source input: " + input);
    assert.ok(panels.slice(offset, offset + 160).includes("clearTimingPreview()"),
      "Changing input must clear a stale preview: " + input);
  }
});
