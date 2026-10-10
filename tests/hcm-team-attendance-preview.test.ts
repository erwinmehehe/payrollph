import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyTeamAttendance, summarizeTeamAttendance } from "../src/lib/hcm-team-attendance-preview";
const basic = { employeeId: 1, name: "Synthetic Worker", workDate: "2026-10-10" };
test("effective scheduled shift and recorded punches are evidence, not certified attendance", () => {
  const row = classifyTeamAttendance({ ...basic,
    schedule: { source: "pattern", isRestDay: false, segments: [{ spansMidnight: true }] },
    punches: [],
  });
  assert.equal(row.state, "scheduled");
  assert.equal(row.overnightSegments, 1);
  assert.equal(row.punchRecords, 0);
  assert.ok(!("coveragePercent" in row));
  assert.ok(!("absent" in row));
});
test("incomplete punch evidence is review, not employee absence", () => {
  const row = classifyTeamAttendance({ ...basic,
    schedule: { source: "override", isRestDay: false, segments: [] },
    punches: [{ timeIn: new Date("2026-10-10T01:00:00Z"), timeOut: null }],
  });
  assert.equal(row.state, "review");
  assert.equal(row.incompletePunchRecords, 1);
  assert.equal(summarizeTeamAttendance([row]).reviewRowsOnPage, 1);
});
test("missing schedule and rest-day punches never suggest covered shift", () => {
  assert.equal(classifyTeamAttendance({ ...basic,
    schedule: { source: "unassigned", isRestDay: false, segments: [] }, punches: [],
  }).state, "unassigned");
  assert.equal(classifyTeamAttendance({ ...basic,
    schedule: { source: "pattern", isRestDay: true, segments: [] },
    punches: [{ timeIn: null, timeOut: null }],
  }).state, "review");
});
test("preview must be default-off, tenant-scoped, read-only and private", () => {
  const api = readFileSync("src/app/api/hcm/team-attendance-preview/route.ts", "utf8");
  const page = readFileSync("src/app/hcm/team-attendance-preview/page.tsx", "utf8");
  const ui = readFileSync("src/components/hcm-team-attendance-preview.tsx", "utf8");
  for (const source of [api, page]) {
    assert.match(source, /HCM_TEAM_ATTENDANCE_PREVIEW_ENABLED !== "true"/);
    assert.match(source, /assertOrganizationRole/);
    assert.match(source, /WORKFORCE_MANAGER_ROLES/);
    assert.match(source, /deriveMyTeamScope/);
  }
  for (const term of ["eq(employees.organizationId, organizationId)", "eq(timePunches.organizationId, organizationId)",
    "inArray(timePunches.employeeId, ids)", "loadResolvedEmployeeSchedule", "private, no-store",
    "limit(11)", "limit(501)"]) assert.ok(api.includes(term), term);
  for (const forbidden of ["db.update(", "db.delete(", "db.insert(", "basicRate", "bankAccount", "leaveReason", "payrollRuns"]) {
    assert.ok(!api.includes(forbidden), forbidden);
  }
  assert.match(ui, /AbortController/);
  assert.match(ui, /controller.signal.aborted/);
  assert.match(ui, /data.organizationId !== organizationId/);
  assert.match(ui, /stored\?\.key === key/);
});
