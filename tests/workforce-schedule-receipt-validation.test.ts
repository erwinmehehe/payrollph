import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { snapshotForReceipt, scheduleReceiptHash, receiptDates, SCHEDULE_RECEIPT_BOUNDARY,
  type ReceiptSourceDay, type ScheduleReceiptView } from "../src/lib/workforce-schedule-receipt";
import { validReceiptSource, validScheduleReceiptView, validScheduleReceiptConfirmation } from "../src/lib/workforce-schedule-receipt-validation";
const site = { id: 4, name: "Fictional office" };
const day = (overrides: Partial<ReceiptSourceDay> = {}): ReceiptSourceDay => ({
  date: "2026-10-10", source: "pattern", isRestDay: false, assignmentId: 1, patternId: 2,
  overrideId: null, workLocationOrgUnitId: null, worksiteId: 4,
  segments: [{ shiftDefinitionId: 5, shiftCode: "DAY", shiftName: "Day shift", segmentOrder: 1,
    startTime: "09:00", endTime: "17:00", breakMinutes: 60, spansMidnight: false }], ...overrides,
});
function view(): ScheduleReceiptView {
  return { boundary: SCHEDULE_RECEIPT_BOUNDARY, days: receiptDates("2026-10-10").map(date => {
    const snapshot = snapshotForReceipt(day({ date }), site)!;
    return { date, snapshot, snapshotHash: scheduleReceiptHash(1, 2, snapshot), state: "pending", acknowledgedAt: null };
  }) };
}

test("overlapping and nested split shifts are not receiptable", () => {
  for (const [startTime, endTime] of [["16:00", "20:00"], ["10:00", "12:00"], ["08:00", "18:00"]]) {
    const value = day();
    value.segments.push({ ...value.segments[0], shiftDefinitionId: 6, segmentOrder: 2, startTime, endTime, breakMinutes: 0 });
    assert.equal(snapshotForReceipt(value, site), null);
    value.segments.reverse();
    assert.equal(snapshotForReceipt(value, site), null);
  }
});
test("touching nonoverlapping split shifts and valid overnight shifts remain receiptable", () => {
  const value = day();
  value.segments[0].endTime = "12:00";
  value.segments.push({ ...value.segments[0], shiftDefinitionId: 6, segmentOrder: 2, startTime: "12:00", endTime: "17:00" });
  assert.ok(snapshotForReceipt(value, site));
  const night = day(); night.segments[0] = { ...night.segments[0], startTime: "22:00", endTime: "06:00", spansMidnight: true };
  assert.ok(snapshotForReceipt(night, site));
  night.segments.push({ ...night.segments[0], shiftDefinitionId: 6, segmentOrder: 2, startTime: "23:00", endTime: "04:00" });
  assert.equal(snapshotForReceipt(night, site), null);
});
test("malformed source evidence fails closed without throwing", () => {
  for (const value of [null, [], {}, { ...day(), isRestDay: "false" }, { ...day(), segments: [null] },
    { ...day(), segments: null }, { ...day(), date: "2026-02-30" },
    { ...day(), segments: [{ ...day().segments[0], shiftCode: null }] }]) {
    assert.equal(validReceiptSource(value), false);
    assert.equal(snapshotForReceipt(value as ReceiptSourceDay, site), null);
  }
});
test("valid v1 content hashes stay byte-for-byte compatible", () => {
  const expected = { version: 1 as const, date: "2026-10-10", source: "pattern" as const, isRestDay: false,
    assignmentId: 1, patternId: 2, overrideId: null, workLocationOrgUnitId: null, worksite: site, segments: day().segments };
  const projected = snapshotForReceipt(day(), site)!;
  assert.equal(JSON.stringify(projected), JSON.stringify(expected));
  assert.equal(scheduleReceiptHash(1, 2, projected), scheduleReceiptHash(1, 2, expected));
});
test("valid available, unavailable, acknowledged and changed receipt states pass", () => {
  const value = view();
  value.days[0] = { ...value.days[0], snapshot: null, snapshotHash: null, state: "unavailable" };
  value.days[1] = { ...value.days[1], state: "acknowledged", acknowledgedAt: "2026-10-10T01:00:00.000Z" };
  value.days[2].state = "changed";
  assert.equal(validScheduleReceiptView(value), true);
});
test("wrong-day snapshots, duplicate or skipped dates and rollover dates are rejected", () => {
  const different = view(); different.days[0].snapshot!.date = "2026-10-11";
  const duplicate = view(); duplicate.days[1] = { ...duplicate.days[0] };
  const skipped = view(); skipped.days[1] = { ...skipped.days[2] };
  const invalid = view(); invalid.days[0].date = "2026-02-30";
  for (const value of [different, duplicate, skipped, invalid, { ...view(), days: view().days.slice(0, 6) }]) {
    assert.equal(validScheduleReceiptView(value), false);
  }
});
test("incomplete or contradictory state evidence cannot display acknowledgment", () => {
  for (const patch of [
    { snapshot: null }, { snapshotHash: null }, { state: "acknowledged", acknowledgedAt: null },
    { state: "unavailable" }, { acknowledgedAt: "2026-10-10T01:00:00.000Z" },
    { state: "acknowledged", acknowledgedAt: "2026-02-30T01:00:00.000Z" },
  ]) { const value = view(); Object.assign(value.days[0], patch); assert.equal(validScheduleReceiptView(value), false); }
});
test("malformed nested response fields and overlap are rejected before rendering", () => {
  for (const patch of [{ segments: [null] }, { segments: [{ shiftCode: "X" }] }, { worksite: { id: 4, name: {} } },
    { isRestDay: "false" }, { version: 2 }]) {
    const value = view(); Object.assign(value.days[0].snapshot!, patch); assert.equal(validScheduleReceiptView(value), false);
  }
  const value = view(); const segment = value.days[0].snapshot!.segments[0];
  value.days[0].snapshot!.segments.push({ ...segment, shiftDefinitionId: 6, segmentOrder: 2 });
  assert.equal(validScheduleReceiptView(value), false);
});
test("success requires the selected date, digest, timestamp and actual boolean result", () => {
  const selected = view().days[0];
  const valid = { created: true, workDate: selected.date, snapshotHash: selected.snapshotHash, acknowledgedAt: "2026-10-10T01:00:00.000Z" };
  assert.equal(validScheduleReceiptConfirmation(valid, selected), true);
  assert.equal(validScheduleReceiptConfirmation({ ...valid, created: false }, selected), true);
  for (const invalid of [null, [], { snapshotHash: selected.snapshotHash }, { ...valid, workDate: "2026-10-11" },
    { ...valid, snapshotHash: "b".repeat(64) }, { ...valid, created: "true" }, { ...valid, acknowledgedAt: "2026-02-30T01:00:00.000Z" },
    { ...valid, acknowledgedAt: null }]) assert.equal(validScheduleReceiptConfirmation(invalid, selected), false);
});
test("client uses shared validators and server page remounts it on identity changes", () => {
  const ui = readFileSync("src/components/employee-schedule-receipts.tsx", "utf8");
  const page = readFileSync("src/app/self/schedule-receipts/page.tsx", "utf8");
  const validation = readFileSync("src/lib/workforce-schedule-receipt-validation.ts", "utf8");
  assert.ok(ui.includes("validScheduleReceiptView(body)"));
  assert.ok(ui.includes("validScheduleReceiptConfirmation(body, target)"));
  assert.ok(ui.includes("response.status !== (body.created ? 201 : 200)"));
  assert.ok(ui.includes("setView(null); setSelected(null); setConfirmed(false);"));
  assert.ok(page.includes("key={`${session.id}:${employee.organizationId}:${employee.id}`}"));
  assert.ok(!validation.includes("node:crypto"));
  assert.ok(validation.includes("import type"));
});
