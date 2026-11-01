import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OperationalException } from "../src/lib/attendance-exception-read";
import { countAttendanceTriageCases, selectAttendanceTriageCases } from "../src/lib/attendance-exception-triage";

function item(
  id: number, status: OperationalException["status"],
  severity: OperationalException["severity"], slaStatus: OperationalException["slaStatus"],
  ownerUserId: number | null, due: string | null, workDate = "2026-10-30",
): OperationalException {
  return {
    id, employeeId: id + 100, workDate, exceptionKind: "test_exception",
    severity, message: "Fictional test event", status, ownerUserId,
    ownerName: null, slaDueAt: due, ageHours: null, slaStatus,
    resolvedAt: null, resolutionNote: null, resolvedByName: null,
    resolutionRecordedAt: null, employee: null,
  };
}

const cases = [
  item(1, "open", "warning", "overdue", 10, "2026-10-29T09:00:00Z"),
  item(2, "open", "blocker", "on_track", null, "2026-10-31T09:00:00Z"),
  item(3, "resolved", "blocker", "resolved", null, null),
  item(4, "open", "blocker", "overdue", null, "2026-10-28T09:00:00Z"),
  item(5, "open", "info", "untracked", 10, null),
  item(6, "open", "warning", "on_track", null, "2026-10-30T09:00:00Z", "2026-10-29"),
];

test("counts use verified rows and exclude resolved records from triage queues", () => {
  assert.deepEqual(countAttendanceTriageCases(cases), {
    all: 6, overdue: 2, unassigned: 3, blocking: 2, warning: 2,
  });
  assert.deepEqual(countAttendanceTriageCases([]), {
    all: 0, overdue: 0, unassigned: 0, blocking: 0, warning: 0,
  });
  assert.deepEqual(selectAttendanceTriageCases(cases, "overdue", "priority").map(x => x.id), [4, 1]);
  assert.deepEqual(selectAttendanceTriageCases(cases, "blocking", "priority").map(x => x.id), [4, 2]);
  assert.deepEqual(selectAttendanceTriageCases(cases, "warning", "priority").map(x => x.id), [1, 6]);
  assert.deepEqual(selectAttendanceTriageCases(cases, "unassigned", "priority").map(x => x.id), [4, 2, 6]);
});

test("priority, SLA and recent views are stable and leave original records unchanged", () => {
  const original = structuredClone(cases);
  assert.deepEqual(selectAttendanceTriageCases(cases, "all", "priority").map(x => x.id), [4, 1, 2, 6, 5, 3]);
  assert.deepEqual(selectAttendanceTriageCases(cases, "all", "sla").map(x => x.id), [4, 1, 6, 2, 5, 3]);
  assert.deepEqual(selectAttendanceTriageCases(cases, "all", "recent").map(x => x.id), [5, 4, 3, 2, 1, 6]);
  assert.deepEqual(selectAttendanceTriageCases([], "overdue", "recent"), []);
  assert.deepEqual(cases, original);
});

test("UI keeps tenant-remounted verified reads; the helper performs no mutations", () => {
  const ui = readFileSync("src/components/workspace/attendance-exceptions-panel.tsx", "utf8");
  const helper = readFileSync("src/lib/attendance-exception-triage.ts", "utf8");
  assert.match(ui, /<ScopedAttendanceExceptionsPanel key=\{props.organizationId\}/);
  assert.match(ui, /readVerifiedAttendanceOperations\(organizationId, startDate, endDate/);
  assert.match(ui, /selectAttendanceTriageCases\(operations\?\.exceptions \?\? \[\], triageFilter, triageSort\)/);
  assert.match(ui, /Showing \{visibleOperationalRows.length\} of \{operations.exceptions.length\} cases/);
  assert.doesNotMatch(helper, /fetch\(|db\.(?:update|insert|delete)|localStorage|sessionStorage/);
});
