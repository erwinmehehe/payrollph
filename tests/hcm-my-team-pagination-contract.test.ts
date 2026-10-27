import assert from "node:assert/strict";
import test from "node:test";
import { validMyTeamResponse } from "../src/lib/hcm-scoped-read-validation";

/**
 * Fictional employer-only response rows. The actual server emits 25-row,
 * ascending employee-ID pages with a cursor equal to the last visible row.
 */
function teamPage(ids: number[], hasMore: boolean, nextCursor: number | null) {
  const items = ids.map((id) => ({
    id,
    employeeNo: "SYNTH-" + id,
    name: "Fictional Worker " + id,
    jobTitle: "Operator",
    employmentType: "Regular",
    status: "Active",
    orgUnitName: "Fictional Operations",
    orgUnitIntegrity: "verified" as const,
    pendingLeaveRecords: 1,
    pendingOvertimeRecords: 0,
    pendingAttendanceCorrections: 0,
    incompletePunchRecords: 0,
  }));
  return {
    organizationId: 7,
    observedAt: "2026-10-27T02:00:00.000Z",
    scope: { kind: "unit" as const, orgUnitId: 13 },
    query: "",
    statusFilter: "all" as const,
    items,
    page: { size: 25, hasMore, nextCursor },
    summary: {
      employeeRecordsThisPage: items.length,
      pendingLeaveRecordsThisPage: items.length,
      pendingOvertimeRecordsThisPage: 0,
      pendingAttendanceCorrectionsThisPage: 0,
      incompletePunchRecordsThisPage: 0,
    },
    warning: "Page-only preview; not certified headcount.",
  };
}

const validate = (value: unknown, cursor = 0) =>
  validMyTeamResponse(value, 7, cursor, "", "all");

test("valid My Team keyset first, continuation, terminal and empty pages remain accepted", () => {
  assert.equal(validate(teamPage(Array.from({ length: 25 }, (_, n) => n + 1), true, 25)), true);
  assert.equal(validate(teamPage([26, 27, 28], false, null), 25), true);
  assert.equal(validate(teamPage(Array.from({ length: 25 }, (_, n) => n + 26), false, null), 25), true);
  assert.equal(validate(teamPage([], false, null), 25), true);
});

test("terminal and empty pages reject any continuation cursor, not just invalid IDs", () => {
  for (const ids of [[], [1, 2], Array.from({ length: 25 }, (_, n) => n + 1)]) {
    for (const bogusCursor of [0, 1, 2, 25, 500]) {
      assert.equal(validate(teamPage(ids, false, bogusCursor)), false,
        "Terminal page must have null cursor even if " + bogusCursor + " is a positive integer");
    }
  }
});

test("hasMore requires a full 25-row page and its exact final displayed ID", () => {
  const full = Array.from({ length: 25 }, (_, n) => n + 1);
  for (const ids of [[], [1], [1, 2], full.slice(0, 24)]) {
    assert.equal(validate(teamPage(ids, true, ids.at(-1) ?? 1)), false,
      "A short/empty page cannot advertise unseen continuation rows");
  }
  for (const bogusCursor of [0, 1, 24, 26, 500]) {
    assert.equal(validate(teamPage(full, true, bogusCursor)), false,
      "Next cursor must equal actual last displayed ID");
  }
  assert.equal(validate(teamPage(full, true, 25)), true);
});

test("reject duplicates, out-of-order rows and records at/before the requested cursor", () => {
  for (const ids of [[2, 1], [3, 3], [4, 2, 9], [3, 4, 2]]) {
    assert.equal(validate(teamPage(ids, false, null)), false,
      "Keyset items must be strictly ordered with no duplicate");
  }
  assert.equal(validate(teamPage([25, 26], false, null), 25), false);
  assert.equal(validate(teamPage([26, 25], false, null), 25), false);
});

test("tenant identity and page counters remain fail-closed", () => {
  const accepted = teamPage([1, 2], false, null);
  assert.equal(validate({ ...accepted, organizationId: 8 }), false);
  assert.equal(validate({ ...accepted, query: "other employer" }), false);
  assert.equal(validate({ ...accepted, summary: {
    ...accepted.summary, employeeRecordsThisPage: 3,
  } }), false);
  assert.equal(validate({ ...accepted, summary: {
    ...accepted.summary, pendingLeaveRecordsThisPage: 1,
  } }), false);
  assert.equal(validate({ ...accepted, items: [...accepted.items,
    ...Array.from({ length: 24 }, (_, n) => accepted.items[0] && { ...accepted.items[0], id: n + 3 })],
  }), false, "A 26-item page must be rejected even if its summary is present");
});
