import assert from "node:assert/strict";
import test from "node:test";
import { receiptContextDates, receiptDates, projectReceiptWindow, snapshotForReceipt, scheduleReceiptHash,
  type ReceiptSourceDay, type ScheduleReceiptView } from "../src/lib/workforce-schedule-receipt";
import { receiptOverlappingDates, validScheduleReceiptView } from "../src/lib/workforce-schedule-receipt-validation";

const segment = (startTime: string, endTime: string, spansMidnight = false) => ({
  shiftDefinitionId: 1, shiftCode: "TEST", shiftName: "Fictional shift", segmentOrder: 1,
  startTime, endTime, spansMidnight, breakMinutes: 0,
});
const day = (date: string, patch: Partial<ReceiptSourceDay> = {}): ReceiptSourceDay => ({
  date, source: "override", isRestDay: false, assignmentId: null, patternId: null, overrideId: 1,
  worksiteId: null, workLocationOrgUnitId: null, segments: [segment("09:00", "17:00")], ...patch,
});
const empty = (date: string): ReceiptSourceDay => day(date, {
  source: "unassigned", isRestDay: true, overrideId: null, segments: [],
});
const context = (dates: readonly string[], overrides: ReceiptSourceDay[]) =>
  receiptContextDates(dates).map(date => overrides.find(source => source.date === date) ?? empty(date));
const midnight = (date: string) => day(date, { segments: [segment("22:00", "06:00", true)] });

function rawView(sources: ReceiptSourceDay[], dates = receiptDates("2031-01-01")): ScheduleReceiptView {
  return { boundary: "Receipt only", days: dates.map(date => {
    const source = sources.find(source => source.date === date);
    const snapshot = source ? snapshotForReceipt(source, null) : null;
    return { date, snapshot, snapshotHash: snapshot ? scheduleReceiptHash(1, 2, snapshot) : null,
      state: snapshot ? "pending" : "unavailable", acknowledgedAt: null };
  }) };
}

test("receipt context checks both sides of a single date and a seven-day week", () => {
  assert.deepEqual(receiptContextDates(["2031-01-01"]), ["2030-12-31", "2031-01-01", "2031-01-02"]);
  const dates = receiptContextDates(receiptDates("2024-02-27"));
  assert.equal(dates.length, 9);
  assert.equal(dates[0], "2024-02-26");
  assert.equal(dates[3], "2024-02-29");
  assert.equal(dates[8], "2024-03-05");
});

test("receipt context rejects duplicates, gaps, reversed, oversized and invalid date windows", () => {
  for (const dates of [[], ["2031-01-01", "2031-01-01"], ["2031-01-01", "2031-01-03"],
    ["2031-01-02", "2031-01-01"], ["2031-02-30"], [...receiptDates("2031-01-01"), "2031-01-08"]]) {
    assert.throws(() => receiptContextDates(dates));
  }
});

test("individually valid shifts cannot hide an overlap across midnight", () => {
  const sources = [midnight("2031-01-01"), day("2031-01-02", { segments: [segment("05:00", "13:00")] })];
  assert.ok(sources.every(source => snapshotForReceipt(source, null)));
  assert.deepEqual([...receiptOverlappingDates(sources)].sort(), ["2031-01-01", "2031-01-02"]);
  assert.deepEqual([...receiptOverlappingDates([...sources].reverse())].sort(), ["2031-01-01", "2031-01-02"]);
});

test("nested next-day work is a conflict but touching endpoints are not", () => {
  assert.equal(receiptOverlappingDates([midnight("2031-01-01"),
    day("2031-01-02", { segments: [segment("01:00", "03:00")] })]).size, 2);
  assert.equal(receiptOverlappingDates([midnight("2031-01-01"),
    day("2031-01-02", { segments: [segment("06:00", "14:00")] })]).size, 0);
});

test("conflicting previous-day work outside the displayed week blocks the first day", () => {
  const dates = receiptDates("2031-01-01");
  const source = context(dates, [midnight("2030-12-31"),
    day(dates[0], { segments: [segment("05:00", "13:00")] })]);
  const projected = projectReceiptWindow(source, dates, []);
  assert.equal(projected.length, 7);
  assert.equal(projected[0].snapshot, null);
  assert.deepEqual(projected.map(item => item.date), dates);
});

test("conflicting following-day work outside the displayed week blocks the last day", () => {
  const dates = receiptDates("2031-01-01");
  const source = context(dates, [midnight(dates[6]),
    day("2031-01-08", { segments: [segment("05:00", "13:00")] })]);
  const projected = projectReceiptWindow(source, dates, []);
  assert.equal(projected.length, 7);
  assert.equal(projected[6].snapshot, null);
  assert.ok(!projected.some(item => item.date === "2031-01-08"));
});

test("single-date acknowledgment projection also checks both adjacent dates", () => {
  const date = "2031-01-01";
  for (const sources of [
    [midnight("2030-12-31"), day(date, { segments: [segment("05:00", "13:00")] })],
    [midnight(date), day("2031-01-02", { segments: [segment("05:00", "13:00")] })],
  ]) assert.equal(projectReceiptWindow(context([date], sources), [date], [])[0].snapshot, null);
});

test("unknown, duplicated or malformed adjacent evidence cannot silently clear a work day", () => {
  const date = "2031-01-01";
  const source = context([date], [day(date)]);
  const malformed = day("2030-12-31", { segments: [segment("25:00", "06:00", true)] });
  for (const variant of [source.slice(1), [...source, source[0]], [malformed, ...source.slice(1)]]) {
    assert.equal(projectReceiptWindow(variant, [date], [])[0].snapshot, null);
  }
});

test("known unassigned neighboring days are not fabricated rest days or conflicts", () => {
  const date = "2031-01-01";
  assert.ok(projectReceiptWindow(context([date], [midnight(date)]), [date], [])[0].snapshot);
  assert.equal(projectReceiptWindow(context([date], []), [date], [])[0].snapshot, null);
});

test("a recorded rest day with no work intervals remains receiptable", () => {
  const date = "2031-01-01";
  const rest = day(date, { isRestDay: true, segments: [] });
  const projected = projectReceiptWindow(context([date], [rest, midnight("2030-12-31")]), [date], []);
  assert.equal(projected[0].snapshot?.isRestDay, true);
});

test("valid content hashes remain unchanged after adjacent-day validation", () => {
  const date = "2031-01-01";
  const original = day(date);
  const before = snapshotForReceipt(original, null)!;
  const after = projectReceiptWindow(context([date], [original]), [date], [])[0].snapshot!;
  assert.deepEqual(after, before);
  assert.equal(scheduleReceiptHash(1, 2, after), scheduleReceiptHash(1, 2, before));
});

test("browser view rejects conflicting adjacent dates, including old acknowledged content", () => {
  const view = rawView([midnight("2031-01-01"), day("2031-01-02", { segments: [segment("05:00", "13:00")] })]);
  assert.equal(validScheduleReceiptView(view), false);
  view.days[0].state = "acknowledged";
  view.days[0].acknowledgedAt = "2030-12-31T12:00:00.000Z";
  assert.equal(validScheduleReceiptView(view), false);
});

test("browser view keeps valid overnight schedules and server-marked unavailable days", () => {
  const view = rawView([midnight("2031-01-01"), day("2031-01-02", { segments: [segment("06:00", "14:00")] })]);
  assert.equal(validScheduleReceiptView(view), true);
  const dates = receiptDates("2031-01-01");
  const projected = projectReceiptWindow(context(dates, [midnight("2030-12-31"),
    day("2031-01-01", { segments: [segment("05:00", "13:00")] })]), dates, []);
  assert.equal(validScheduleReceiptView({ boundary: "Receipt only", days: projected.map(item => ({ ...item,
    state: item.snapshot ? "pending" : "unavailable", acknowledgedAt: null,
    snapshotHash: item.snapshot ? scheduleReceiptHash(1, 2, item.snapshot) : null,
  })) }), true);
});
