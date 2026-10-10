import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveMyTeamScope } from "../src/lib/hcm-my-team-contract";
import { classifyTeamAttendance, summarizeTeamAttendance } from "../src/lib/hcm-team-attendance-preview";
import { philippineBusinessDate } from "../src/lib/hcm-team-attendance-preview-server";

const worker = { employeeId: 1, name: "Synthetic Worker", workDate: "2026-10-10" };

test("Philippine current-day semantics hold across UTC/Manila midnight", () => {
  assert.equal(philippineBusinessDate(new Date("2026-10-09T15:59:59Z")), "2026-10-09");
  assert.equal(philippineBusinessDate(new Date("2026-10-09T16:00:00Z")), "2026-10-10");
});

test("scheduled evidence with no punches never certifies physical presence or absence", () => {
  const row = classifyTeamAttendance({ ...worker,
    schedule: { source: "pattern", isRestDay: false, segments: [{ spansMidnight: true }] },
    punches: [],
  });
  assert.equal(row.state, "scheduled");
  assert.equal(row.overnightSegments, 1);
  assert.equal(row.punchRecords, 0);
  assert.ok(!("coveragePercent" in row));
  assert.ok(!("absent" in row));
});

test("one-sided and entirely missing punch timestamp records require review", () => {
  for (const punch of [
    { timeIn: new Date("2026-10-10T01:00:00Z"), timeOut: null },
    { timeIn: null, timeOut: null },
    { timeIn: null, timeOut: new Date("2026-10-10T10:00:00Z") },
  ]) {
    const row = classifyTeamAttendance({ ...worker,
      schedule: { source: "override", isRestDay: false, segments: [{ spansMidnight: false }] },
      punches: [punch],
    });
    assert.equal(row.state, "review");
    assert.equal(row.incompletePunchRecords, 1);
    assert.equal(summarizeTeamAttendance([row]).reviewRowsOnPage, 1);
  }
});

test("unassigned, invalid empty working day and rest-day punch never imply coverage", () => {
  assert.equal(classifyTeamAttendance({ ...worker,
    schedule: { source: "unassigned", isRestDay: false, segments: [] }, punches: [],
  }).state, "unassigned");
  assert.equal(classifyTeamAttendance({ ...worker,
    schedule: { source: "pattern", isRestDay: false, segments: [] }, punches: [],
  }).state, "review");
  assert.equal(classifyTeamAttendance({ ...worker,
    schedule: { source: "pattern", isRestDay: true, segments: [] },
    punches: [{ timeIn: new Date("2026-10-10T01:00:00Z"), timeOut: new Date("2026-10-10T08:00:00Z") }],
  }).state, "review");
});

test("manager must have a concrete unit; owner/HR may be company-wide", () => {
  assert.deepEqual(deriveMyTeamScope({ role: "manager", companyWide: false, orgUnitId: 21 }),
    { kind: "unit", orgUnitId: 21 });
  assert.equal(deriveMyTeamScope({ role: "manager", companyWide: true, orgUnitId: null }), null);
  assert.equal(deriveMyTeamScope({ role: "bookkeeper", companyWide: true, orgUnitId: null }), null);
  assert.deepEqual(deriveMyTeamScope({ role: "hr", companyWide: true, orgUnitId: null }),
    { kind: "company", orgUnitId: null });
});

test("API/page are default-off, tenant-scoped, read-only and client avoids stale responses", () => {
  const api = readFileSync("src/app/api/hcm/team-attendance-preview/route.ts", "utf8");
  const page = readFileSync("src/app/hcm/team-attendance-preview/page.tsx", "utf8");
  const server = readFileSync("src/lib/hcm-team-attendance-preview-server.ts", "utf8");
  const ui = readFileSync("src/components/hcm-team-attendance-preview.tsx", "utf8");
  for (const source of [api, page]) {
    assert.match(source, /HCM_TEAM_ATTENDANCE_PREVIEW_ENABLED !== "true"/);
    assert.match(source, /assertOrganizationRole/);
    assert.match(source, /WORKFORCE_MANAGER_ROLES/);
    assert.match(source, /deriveMyTeamScope/);
  }
  for (const expected of [
    "eq(employees.organizationId, organizationId)",
    "eq(employees.orgUnitId, scope.orgUnitId)",
    "eq(orgUnits.organizationId, organizationId)",
    "eq(orgUnits.active, true)",
    "orgUnits.effectiveFrom",
    "orgUnits.effectiveUntil",
    "eq(timePunches.organizationId, organizationId)",
    "inArray(timePunches.employeeId, employeeIds)",
    "loadResolvedEmployeeSchedule",
    "limit(PAGE_SIZE + 1)",
    "limit(PUNCH_CAP + 1)",
  ]) assert.ok(server.includes(expected), expected);
  assert.match(api, /private, no-store/);
  assert.match(api, /TeamAttendanceSourceOverflowError/);
  assert.match(api, /409/);
  for (const source of [api, server]) {
    for (const forbidden of ["db.update(", "db.delete(", "db.insert(", "basicRate", "bankAccount", "leaveReason", "payrollRuns"]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  }
  assert.match(ui, /AbortController/);
  assert.match(ui, /controller.signal.aborted/);
  assert.match(ui, /data.organizationId !== organizationId/);
  assert.match(ui, /stored\?\.key === key/);
});
