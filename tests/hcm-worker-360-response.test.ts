import assert from "node:assert/strict";
import test from "node:test";
import { isValidWorker360Response as valid } from "../src/lib/hcm-worker-360-response";

function sample() {
  return {
    tenantId: 10, employeeId: 23, asOfDate: "2026-10-25",
    observedAt: "2026-10-25T09:02:00.000Z",
    worker: { source: "employees", id: 23, employeeNo: "FIC-23", name: "Fictional Worker",
      currentTitle: "Staff", currentStatus: "Active", startedOn: "2026-02-01" },
    primaryAssignment: { source: "position_assignments", selection: {
      status: "recorded", assignment: { id: 7, positionId: 19, assignmentType: "primary",
        effectiveFrom: "2026-03-01", effectiveUntil: null },
    } },
    employmentEvents: { source: "worker_employment_events", preview: {
      items: [{ id: 9, effectiveDate: "2026-10-10", eventType: "transfer", positionAssignmentId: 7 },
        { id: 8, effectiveDate: "2026-02-01", eventType: "hire", positionAssignmentId: null }],
      hasMore: true, partial: true, nextCursor: { id: 8, effectiveDate: "2026-02-01" },
    } },
  };
}
function changed(mutator: (v: ReturnType<typeof sample>) => void) {
  const value = sample();
  mutator(value);
  return value;
}

test("valid snapshot accepts the exact worker and a bounded source cursor", () => {
  assert.equal(valid(sample(), 10, 23, "2026-10-25"), true);
  assert.equal(valid(changed(v => {
    v.primaryAssignment.selection.status = "not_recorded";
    v.primaryAssignment.selection.assignment = null as unknown as typeof v.primaryAssignment.selection.assignment;
    v.employmentEvents.preview.items = [];
    v.employmentEvents.preview.hasMore = false;
    v.employmentEvents.preview.partial = false;
    v.employmentEvents.preview.nextCursor = null as unknown as typeof v.employmentEvents.preview.nextCursor;
  }), 10, 23, "2026-10-25"), true);
});

test("unexpected employer, worker, nested worker ID and source labels fail closed", () => {
  assert.equal(valid(sample(), 11, 23, "2026-10-25"), false);
  assert.equal(valid(sample(), 10, 24, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.worker.id = 24; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.worker.source = "foreign"; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.employmentEvents.source = "other"; }), 10, 23, "2026-10-25"), false);
});

test("broken dates, nested assignment and timestamps never render as valid HR evidence", () => {
  assert.equal(valid(changed(v => { v.observedAt = "broken timestamp"; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.worker.startedOn = "2026-02-29"; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.primaryAssignment.selection.assignment = null as unknown as typeof v.primaryAssignment.selection.assignment; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.primaryAssignment.selection.assignment.effectiveFrom = "2027-01-01"; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.primaryAssignment.selection.status = "not_recorded"; }), 10, 23, "2026-10-25"), false);
});

test("history rejects future dates, duplicates, malformed source codes and forged cursor", () => {
  assert.equal(valid(changed(v => { v.employmentEvents.preview.items[0].effectiveDate = "2027-01-01"; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.employmentEvents.preview.items[1].id = 9; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.employmentEvents.preview.items[0].eventType = "private free text / notes"; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.employmentEvents.preview.nextCursor.id = 9; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.employmentEvents.preview.partial = false; }), 10, 23, "2026-10-25"), false);
  assert.equal(valid(changed(v => { v.employmentEvents.preview.items.reverse(); }), 10, 23, "2026-10-25"), false);
});

test("malformed and untrusted HTTP JSON never become verified success", () => {
  for (const value of [null, {}, [], { tenantId: 10, employeeId: 23 }, "hello"]) {
    assert.equal(valid(value, 10, 23, "2026-10-25"), false);
  }
  assert.equal(valid(changed(v => {
    v.employmentEvents.preview.items = null as unknown as typeof v.employmentEvents.preview.items;
  }), 10, 23, "2026-10-25"), false);
});
