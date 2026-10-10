import assert from "node:assert/strict";
import test from "node:test";
import { manilaInboxToday, scheduleChangeInbox, managerAttentionDates } from "../src/lib/workforce-schedule-change-inbox";
const dates = Array.from({ length: 7 }, (_, i) => "2030-01-0" + (i + 1));
const days = dates.map((date, i) => ({
  date, state: i === 0 ? "changed" : i === 1 ? "pending" : i === 2 ? "acknowledged" : "unavailable",
  snapshotHash: i < 3 ? "a".repeat(64) : null,
}));
test("inbox surfaces changed and review-needed from a current seven-day receipt window", () => {
  const v = scheduleChangeInbox({ days }, "2030-01-01");
  assert.deepEqual(v.notices.map(n => n.kind), ["changed", "review"]);
  assert.equal(v.acknowledged, 1);
  assert.equal(v.unavailable, 4);
  assert.equal(v.notices.length, 2);
  assert.ok(!JSON.stringify(v).includes("a".repeat(64)));
});
test("inbox rejects outdated, out-of-order, incomplete, duplicate, and malformed evidence", () => {
  for (const items of [days.slice(0,6), [...days.slice(1),days[0]], [...days.slice(0,6),days[0]]]) {
    assert.throws(() => scheduleChangeInbox({ days: items }, "2030-01-01"));
  }
  assert.throws(() => scheduleChangeInbox({ days }, "2030-01-02"));
  assert.throws(() => scheduleChangeInbox({ days }, "2030-02-30"));
  assert.throws(() => scheduleChangeInbox({ days: [{...days[0],snapshotHash: "bad"},...days.slice(1)] }, "2030-01-01"));
  assert.throws(() => scheduleChangeInbox({ days: [{...days[0],state: "absence"},...days.slice(1)] }, "2030-01-01"));
});
test("same content produces deterministic distinct date notices", () => {
  const a = scheduleChangeInbox({ days }, "2030-01-01");
  const b = scheduleChangeInbox({ days }, "2030-01-01");
  assert.deepEqual(a, b);
  assert.equal(new Set(a.notices.map(n=>n.date)).size, a.notices.length);
});
test("manager follow-up omits source errors and already seen dates", () => {
  assert.deepEqual(managerAttentionDates(days), dates.slice(0,2));
  assert.throws(() => managerAttentionDates([...days.slice(0,6),days[0]]));
});
test("Philippine midnight rollover uses local work date", () => {
  assert.equal(manilaInboxToday(new Date("2029-12-31T15:59:59Z")), "2029-12-31");
  assert.equal(manilaInboxToday(new Date("2029-12-31T16:00:00Z")), "2030-01-01");
});
test("employee inbox links never carry user, tenant or schedule hash and do not mutate receipts", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const src = fs.readFileSync("src/components/employee-schedule-change-inbox.tsx", "utf8");
  assert.ok(src.includes('href="/self/schedule-receipts"'));
  assert.ok(src.includes('NEXT_PUBLIC_WFM_SCHEDULE_CHANGE_INBOX_ENABLED'));
  assert.ok(src.includes('fetch("/api/self/schedule-receipts"'));
  assert.ok(!src.includes('method: "POST"'));
  assert.ok(!src.includes("localStorage"));
});
