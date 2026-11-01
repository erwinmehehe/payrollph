import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendDistinctToast, MAX_VISIBLE_TOASTS } from "../src/lib/toast-queue";

const source = (path: string) => readFileSync(path, "utf8");

test("error notifications are deduplicated without losing their first identity", () => {
  const initial = [{ id: 1, kind: "err", message: "Could not load attendance exceptions." }];
  assert.equal(
    appendDistinctToast(initial, { id: 2, kind: "err", message: initial[0].message }),
    initial,
  );
  const another = appendDistinctToast(initial, { id: 3, kind: "err", message: "Other endpoint unavailable." });
  assert.equal(another.length, 2);
  assert.deepEqual(another.map((notice) => notice.id), [1, 3]);
});

test("notifications do not cover the screen when several services fail", () => {
  const events = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, kind: "err", message: `service ${index + 1} failed`,
  }));
  const visible = events.reduce((current, toast) => appendDistinctToast(current, toast), [] as typeof events);
  assert.equal(visible.length, MAX_VISIBLE_TOASTS);
  assert.deepEqual(visible.map((item) => item.id), [17, 18, 19, 20]);
});

test("notification callbacks remain stable across rerenders", () => {
  const ui = source("src/components/workspace/ui.tsx");
  assert.ok(ui.includes("const notify = useCallback("));
  assert.ok(ui.includes("const dismiss = useCallback("));
  assert.ok(ui.includes("appendDistinctToast(current,"));
});

test("attendance loads one scoped request per dependency change, never one per notification", () => {
  const panel = source("src/components/workspace/attendance-exceptions-panel.tsx");
  const load = panel.split("const load = useCallback(async () => {")[1]?.split("const mutateOperationalException")[0];
  assert.ok(load, "attendance loader must be present");
  assert.ok(load.includes("Promise.allSettled("), "analysis and operations must fail independently");
  assert.ok(load.includes("activeRequest.current?.abort()"), "obsolete requests must be cancelled");
  assert.ok(load.includes("controller.signal.aborted"), "late responses must not update another employer");
  assert.ok(!load.includes("notify("), "background reads must not create global error toasts");
  assert.ok(load.includes("[endDate, organizationId, startDate]"), "only scope/date changes trigger fetching");
});

test("failed attendance reads show retryable inline errors, not false zero-exception success", () => {
  const panel = source("src/components/workspace/attendance-exceptions-panel.tsx");
  const locks = source("src/components/workspace/attendance-lock-control.tsx");
  assert.ok(panel.includes('title="Attendance exception analysis unavailable"'));
  assert.ok(panel.includes('title="Exception ownership unavailable"'));
  assert.ok(panel.includes('onRetry={() => void load()}'));
  assert.ok(panel.includes('value={operations ? String(operations.summary.open) : "—"}'));
  // The operation read must succeed before an empty or filtered-empty queue is rendered.
  assert.ok(panel.includes('!loading && operations !== null && visibleOperationalRows.length === 0'));
  // An empty verified employer window and a nonempty window hidden by triage
  // filters must have different explanations, never a false all-clear.
  assert.ok(panel.includes('title={operations.exceptions.length === 0'));
  assert.ok(panel.includes('"No persisted exception cases in this window"'));
  assert.ok(panel.includes('"No cases match the selected triage queue"'));
  assert.ok(panel.includes('!loading && payload !== null && rows.length === 0'));
  assert.ok(locks.includes('title="Attendance lock status unavailable"'));
  assert.ok(!locks.includes('notify(error.message, "err")'));
});
