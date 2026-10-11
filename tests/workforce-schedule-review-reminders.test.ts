import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { receiptDates, type ScheduleReceiptDay, type ScheduleReceiptSnapshot, type ScheduleReceiptView } from "../src/lib/workforce-schedule-receipt";
import { explicitReminderEmployerIds, scheduleReviewSignals } from "../src/lib/workforce-schedule-review-reminders";

const start = "2026-10-11";
function snapshot(date: string, rest = false): ScheduleReceiptSnapshot {
  return {
    version: 1, date, source: "pattern", isRestDay: rest,
    assignmentId: 1, patternId: 2, overrideId: null,
    workLocationOrgUnitId: null, worksite: null,
    segments: rest ? [] : [{
      shiftDefinitionId: 1, shiftCode: "DAY", shiftName: "Day shift",
      segmentOrder: 1, startTime: "09:00", endTime: "17:00",
      spansMidnight: false, breakMinutes: 60,
    }],
  };
}
function receipt(state: ScheduleReceiptDay["state"], date: string, rest = false): ScheduleReceiptDay {
  return { date, state, snapshot: state === "unavailable" ? null : snapshot(date, rest),
    snapshotHash: state === "unavailable" ? null : "a".repeat(64), acknowledgedAt: null };
}
function view(): ScheduleReceiptView {
  const dates = receiptDates(start);
  return { boundary: "Synthetic-only schedule review", days: dates.map((date, i) =>
    receipt(i === 0 ? "changed" : i === 1 || i === 2 || i === 3 ? "pending"
      : i === 4 ? "acknowledged" : "unavailable", date, i === 2)) };
}
const who = { organizationId: 100, employeeId: 200, userId: 300 };
const now = new Date("2026-10-11T10:00:00+08:00");

test("source-identity scoped deterministic versions produce one changed and one due-soon shift event", () => {
  const input = { ...who, now, view: view() };
  const events = scheduleReviewSignals(input);
  assert.deepEqual(events.map(x => [x.workDate, x.reason]), [
    ["2026-10-11", "published_change"],
    ["2026-10-12", "upcoming_unacknowledged"],
  ]);
  assert.deepEqual(events, scheduleReviewSignals(input), "retries use stable idempotency keys");
  assert.ok(events.every(e => e.eventKey.includes(e.snapshotHash)));
  assert.ok(events.every(e => e.eventKey.includes(":100:200:300:")));
  assert.ok(events.every(e => e.eventKey.length <= 240));
});

test("a changed content hash creates a new event; pending rest and far future are never nudged", () => {
  const original = view();
  const first = scheduleReviewSignals({ ...who, now, view: original })[0].eventKey;
  original.days[0].snapshotHash = "b".repeat(64);
  const second = scheduleReviewSignals({ ...who, now, view: original })[0].eventKey;
  assert.notEqual(first, second);
  assert.equal(scheduleReviewSignals({ ...who, now: new Date("2026-10-12T10:00:00+08:00"),
    view: { ...original, days: original.days.map(d => d.state === "changed" ? { ...d, state: "acknowledged" } : d) } })
    .some(x => x.workDate === "2026-10-12" && x.reason === "upcoming_unacknowledged"), false,
    "reminder is not emitted for a shift already started");
});

test("published approved overrides prompt review even before prior acknowledgment", () => {
  const data = view();
  data.days[3].snapshot!.source = "override";
  data.days[3].snapshot!.assignmentId = null;
  data.days[3].snapshot!.patternId = null;
  data.days[3].snapshot!.overrideId = 99;
  const active = scheduleReviewSignals({ ...who, now, view: data });
  assert.deepEqual(active.find(x => x.workDate === "2026-10-14")?.reason, "published_change");
  data.days[2].snapshot!.source = "override";
  data.days[2].snapshot!.overrideId = 101;
  assert.equal(scheduleReviewSignals({ ...who, now, view: data })
    .find(x => x.workDate === "2026-10-13")?.reason, "published_change",
    "approved rest-day changes are reviewable, not an absence finding");
});

test("broken scope and invalid window must fail closed, not manufacture notifications", () => {
  const original = view();
  for (const bad of [{ ...who, employeeId: -1 }, { ...who, userId: 0 }]) {
    assert.deepEqual(scheduleReviewSignals({ ...bad, now, view: original }), []);
  }
  assert.deepEqual(scheduleReviewSignals({ ...who, now, view: { ...original, days: original.days.slice(0, 6) } }), []);
  const dateJump = view(); dateJump.days[1].date = "2026-12-01";
  assert.deepEqual(scheduleReviewSignals({ ...who, now, view: dateJump }), []);
  const noHash = view(); noHash.days[0].snapshotHash = "not-hash";
  assert.equal(scheduleReviewSignals({ ...who, now, view: noHash }).length, 1);
});

test("notification employer allowlist explicitly denies empty, wildcard, duplicate and invalid values", () => {
  for (const value of [undefined, "", "*", "1,*", "0", "-1", "1,01", "1,1",
    "1,invalid", "2147483648", Array.from({ length: 21 }, (_, i) => i+1).join(",")]) {
    assert.equal(explicitReminderEmployerIds(value), null, JSON.stringify(value));
  }
  assert.deepEqual(explicitReminderEmployerIds("12, 13"), [12, 13]);
});

test("scheduler / Automation Studio wiring remains default OFF, using existing dedup/outbox", () => {
  const engine = readFileSync("src/lib/automation.ts", "utf8");
  const templates = readFileSync("src/lib/automation-templates.ts", "utf8");
  const temporal = readFileSync("src/lib/automation-temporal-events.ts", "utf8");
  const server = readFileSync("src/lib/workforce-schedule-review-reminders-server.ts", "utf8");
  assert.match(engine, /"workforce\.schedule_review_due"/);
  assert.match(templates, /id: "workforce-employee-schedule-review"/);
  assert.match(templates, /recipient: "employee"/);
  assert.match(temporal, /WFM_SCHEDULE_REVIEW_REMINDERS_ENABLED === "true"/);
  assert.match(server, /WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS/);
  assert.match(server, /WFM_SCHEDULE_REVIEW_REMINDERS_ORG_IDS/);
  assert.match(server, /cohort-too-large/);
  assert.match(server, /readScheduleReceiptView\(row/);
  assert.match(server, /runAutomationEventSafely/);
  assert.match(server, /accountCounts/);
});
