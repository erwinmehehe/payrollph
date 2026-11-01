import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { TeamLeaveCase } from "../src/lib/hcm-team-leave-calendar-contract";
import { selectTeamLeaveCases, summarizeVisibleTeamLeaveMonth } from "../src/lib/hcm-team-leave-calendar-view";

const cases: TeamLeaveCase[] = [
  { requestId: 11, employeeId: 101, employeeNo: "T1", employeeName: "Example A",
    status: "Approved", startDate: "2026-10-01", endDate: "2026-10-03" },
  { requestId: 12, employeeId: 102, employeeNo: "T2", employeeName: "Example B",
    status: "Pending", startDate: "2026-10-02", endDate: "2026-10-02" },
  { requestId: 13, employeeId: 103, employeeNo: "T3", employeeName: "Example C",
    status: "Approved", startDate: "2026-10-02", endDate: "2026-10-04" },
];

test("approved/pending views filter source records without mutating the scoped payload", () => {
  const before = structuredClone(cases);
  assert.deepEqual(selectTeamLeaveCases(cases, "all").map(x => x.requestId), [11, 12, 13]);
  assert.deepEqual(selectTeamLeaveCases(cases, "approved").map(x => x.requestId), [11, 13]);
  assert.deepEqual(selectTeamLeaveCases(cases, "pending").map(x => x.requestId), [12]);
  assert.deepEqual(selectTeamLeaveCases([], "approved"), []);
  assert.deepEqual(cases, before);
});

test("month summary counts source request-span days, never inferred absences", () => {
  assert.deepEqual(summarizeVisibleTeamLeaveMonth("2026-10", cases), {
    visibleRequestRecords: 3, datesWithAnySpans: 4, datesWithMultipleSpans: 2,
  });
  assert.deepEqual(summarizeVisibleTeamLeaveMonth("2026-10", selectTeamLeaveCases(cases, "approved")), {
    visibleRequestRecords: 2, datesWithAnySpans: 4, datesWithMultipleSpans: 2,
  });
  assert.deepEqual(summarizeVisibleTeamLeaveMonth("2026-10", selectTeamLeaveCases(cases, "pending")), {
    visibleRequestRecords: 1, datesWithAnySpans: 1, datesWithMultipleSpans: 0,
  });
  assert.deepEqual(summarizeVisibleTeamLeaveMonth("2026-11", []), {
    visibleRequestRecords: 0, datesWithAnySpans: 0, datesWithMultipleSpans: 0,
  });
  const duplicateRecords = [cases[0], { ...cases[0], requestId: 14 }];
  assert.equal(summarizeVisibleTeamLeaveMonth("2026-10", duplicateRecords).datesWithMultipleSpans, 3,
    "Indicator is about recorded requests, not unique employees or confirmed availability");
});

test("leave view keeps verified employer/month scope, abort and read-only behavior", () => {
  const ui = readFileSync("src/components/hcm-team-leave-calendar.tsx", "utf8");
  const helper = readFileSync("src/lib/hcm-team-leave-calendar-view.ts", "utf8");
  assert.match(ui, /validTeamLeaveResponse\(payload, organizationId, month, expectedDates\)/);
  assert.match(ui, /loaded\?\.requestKey === requestKey/);
  assert.match(ui, /controller\.abort\(\)/);
  assert.match(ui, /selectTeamLeaveCases\(page\?\.cases \?\? \[\], leaveFilter\)/);
  assert.match(ui, /summarizeVisibleTeamLeaveMonth\(month, visibleCases\)/);
  for (const forbidden of ["method: \"POST\"", "method: \"PATCH\"", "leaveType", "bankAccount"]) {
    assert.ok(!ui.includes(forbidden));
  }
  assert.doesNotMatch(helper, /fetch\(|localStorage|sessionStorage/);
});
