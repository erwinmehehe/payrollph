import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeLiveFloorSnapshot, liveFloorScopeKey } from "../src/lib/workforce-live-floor-client";
import { activeTeamRosterPayload, teamRosterScopeKey } from "../src/lib/workforce-team-roster-client";
import { rosterBulkPilotOrganizationAllowed } from "../src/lib/workforce-bulk-publish";
import { upcomingSevenDays } from "../src/lib/workforce-employee-upcoming-week";

const read = (path: string) => readFileSync(path, "utf8");

test("consolidated WFM preserves tenant-bound manager views and explicit pilot authorization", () => {
  const floor = { scopeKey: liveFloorScopeKey(11, 1), data: { rows: ["fictional tenant A"] } };
  assert.equal(activeLiveFloorSnapshot(floor, liveFloorScopeKey(12, 1)), null);
  const roster = { scopeKey: teamRosterScopeKey(11, "2026-10-12", 1, ""), data: { rows: [] } };
  assert.equal(activeTeamRosterPayload(roster, teamRosterScopeKey(12, "2026-10-12", 1, "")), null);
  assert.equal(rosterBulkPilotOrganizationAllowed(11, "11"), true);
  assert.equal(rosterBulkPilotOrganizationAllowed(12, "11"), false);
  assert.equal(rosterBulkPilotOrganizationAllowed(11, "*"), false);
  assert.equal(rosterBulkPilotOrganizationAllowed(11, ""), false);
});

test("employee schedule remains advisory when its roster source is unassigned", () => {
  const days = upcomingSevenDays([
    { date: "2026-10-10", source: "unassigned", isRestDay: true, segments: [] },
  ], "2026-10-10");
  assert.equal(days[0].state, "unassigned");
  assert.equal(days[0].changed, false);
  assert.equal(days.length, 7);
});

test("consolidation retains batch kill switch, both tenant gates and atomic source writes", () => {
  const api = read("src/app/api/workforce/roster-batches/route.ts");
  assert.equal((api.match(/if \(!rosterBulkPilotOrganizationAllowed\(organizationId\)\)/g) ?? []).length, 2);
  assert.ok(api.includes("if (!rosterBulkPublishEnabled())"));
  assert.ok(api.includes("canReviewRosterBatch(batch.requestedByUserId, user.id)"));
  assert.ok(api.includes("tx.insert(scheduleOverrides)"));
  assert.ok(api.includes("tx.insert(auditEvents)"));
  assert.ok(api.includes("pg_advisory_xact_lock(6107"));
});

test("consolidation keeps mainline workspace compatibility and employee fetch isolation", () => {
  const page = read("src/app/app/page.tsx");
  const employee = read("src/components/employee-workforce-panel.tsx");
  assert.ok(page.includes("await isSelfServeOrganization(companyOrganizationId)"));
  assert.ok(employee.includes("data-employee-upcoming-week"));
  assert.ok(employee.includes("currentLoad.current?.abort()"));
  assert.ok(employee.includes("setPayload(null)"));
  assert.ok(employee.includes("setToday(manilaWorkDate())"));
});
