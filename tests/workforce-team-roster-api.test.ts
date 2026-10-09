import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync("src/app/api/workforce/team-roster/route.ts", "utf8");
const panel = readFileSync("src/components/workspace/workforce-team-roster-panel.tsx", "utf8");
const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");

test("team roster GET requires authenticated, permission-checked People admin", () => {
  assert.ok(api.includes("getSessionUser()"));
  assert.ok(api.includes("assertOrganizationRole("));
  assert.ok(api.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(api.includes("getAccess(user.id, organizationId)"));
  assert.ok(api.includes("!access.companyWide"));
});

test("all team roster relational reads are tenant scoped", () => {
  for (const table of [
    "employees",
    "shiftDefinitions",
    "schedulePatterns",
    "scheduleOverrides",
    "employeeScheduleAssignments",
    "employeeWorksiteAssignments",
    "worksites",
  ]) {
    assert.ok(api.includes("eq(" + table + ".organizationId, organizationId)"), table);
  }
  assert.ok(api.includes("eq(employees.orgUnitId, access.orgUnitId!)"));
  assert.ok(api.includes("inArray(employeeScheduleAssignments.employeeId, employeeIds)"));
  assert.ok(api.includes("inArray(scheduleOverrides.employeeId, employeeIds)"));
});

test("team roster uses bounded pages and deterministic payroll schedule evidence", () => {
  assert.ok(api.includes("const PAGE_SIZE = 20"));
  assert.ok(api.includes(".limit(PAGE_SIZE)"));
  assert.ok(api.includes(".offset((page - 1) * PAGE_SIZE)"));
  assert.ok(api.includes("rosterWeekDates(startDate)"));
  assert.ok(api.includes("resolveDailySchedule({"));
  assert.ok(api.includes("selectEffectiveWorksiteAssignment("));
  assert.ok(api.includes('Cache-Control": "no-store"'));
  assert.ok(api.includes("Schedule evidence needs review"));
});

test("the team tab is real, and day changes use the existing guarded mutation", () => {
  assert.ok(planner.includes("['team', 'Team roster']"));
  assert.ok(planner.includes("wfm-panel-team"));
  assert.ok(planner.includes("<WorkforceTeamRosterPanel"));
  assert.ok(panel.includes('fetch("/api/workforce/team-roster?"'));
  assert.ok(panel.includes('fetch("/api/workforce/schedules"'));
  assert.ok(panel.includes('action: "create_override"'));
  assert.ok(panel.includes('day.source === "override"'));
  assert.ok(panel.includes("acknowledged"));
  assert.ok(!panel.includes("localStorage"));
});
