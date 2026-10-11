import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { summarizeEmployeeReceiptDays, visibleEmployeeReceiptDays } from "../src/lib/workforce-schedule-receipt-presentation";
import type { ScheduleReceiptDay } from "../src/lib/workforce-schedule-receipt";

const make = (state: ScheduleReceiptDay["state"]): ScheduleReceiptDay => ({
  date: "2026-10-11", state, snapshot: null, snapshotHash: null, acknowledgedAt: null,
});
test("compact projection keeps pending, changed and unavailable but does not misclassify acknowledged", () => {
  const days = [make("acknowledged"), make("pending"), make("changed"), make("unavailable")];
  assert.deepEqual(summarizeEmployeeReceiptDays(days), {
    acknowledged: 1, pending: 1, changed: 1, unavailable: 1, requiresReview: 2,
  });
  assert.deepEqual(visibleEmployeeReceiptDays(days, true).map(day => day.state),
    ["pending", "changed", "unavailable"]);
  assert.equal(visibleEmployeeReceiptDays(days, false).length, 4);
});
test("empty receipt response is not a claim of successful acknowledgment", () => {
  assert.deepEqual(summarizeEmployeeReceiptDays([]), {
    acknowledged: 0, pending: 0, changed: 0, unavailable: 0, requiresReview: 0,
  });
});
test("employee Time workspace reuses server-gated existing receipt UI; no new mutation route", () => {
  const panel = readFileSync("src/components/employee-workforce-panel.tsx", "utf8");
  const child = readFileSync("src/components/employee-schedule-receipts.tsx", "utf8");
  assert.match(panel, /NEXT_PUBLIC_WFM_SCHEDULE_RECEIPTS_ENABLED/);
  assert.match(panel, /<EmployeeScheduleReceipts compact \/>/);
  assert.match(child, /validScheduleReceiptView\(body\)/);
  assert.match(child, /validScheduleReceiptConfirmation\(body, target\)/);
  assert.match(child, /fetch\("\/api\/self\/schedule-receipts"/);
  assert.match(child, /Acknowledge this snapshot/);
  assert.match(child, /Attendance and payroll were not changed/);
});
