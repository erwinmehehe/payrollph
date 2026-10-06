import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("time workspace exposes governed attendance capture controls", () => {
  const panel = readFileSync("src/components/workspace/attendance-capture-controls-panel.tsx", "utf8");
  const time = readFileSync("src/components/workspace/time.tsx", "utf8");
  assert.ok(panel.includes("Web Bundy"));
  assert.ok(panel.includes("Mobile clock"));
  assert.ok(panel.includes("Registered kiosk"));
  assert.ok(panel.includes("Offline synchronization"));
  assert.ok(panel.includes("Require location evidence"));
  assert.ok(panel.includes("Hardware acceptance remains a certification step"));
  assert.ok(time.includes("<AttendanceCaptureControlsPanel"));
});
