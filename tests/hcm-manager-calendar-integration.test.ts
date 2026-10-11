import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("My Team retains allowlisted calendar navigation alongside manager action center", () => {
  const ui = readFileSync("src/components/hcm-my-team.tsx", "utf8");
  assert.ok(ui.includes("HcmMyTeamActionCenter"));
  assert.ok(ui.includes('process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ENABLED === "true"'));
  assert.ok(ui.includes("NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ORG_IDS"));
  assert.ok(ui.includes('id.trim() === String(organizationId)'));
  assert.ok(ui.includes("/hcm/team-leave-calendar?organizationId="));
  assert.ok(ui.includes("canOpenLeaveCalendar && data"));
  assert.ok(ui.includes("pendingAttendanceCorrectionsThisPage"));
  assert.ok(ui.includes("incompletePunchRecordsThisPage"));
  assert.ok(ui.includes("/app?organizationId="));
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  assert.ok(workspace.includes("requestedMyTeamWorkspacePage({"));
  assert.ok(workspace.includes("pilotCoreNavigationPages"));
});

test("standalone HCM browser tests retain the calendar's disabled flags and manager counts", () => {
  const browser = readFileSync("scripts/hcm-request-lifecycle-browser.mjs", "utf8");
  assert.ok(browser.includes('process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ENABLED'));
  assert.ok(browser.includes('process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ORG_IDS'));
  assert.ok(browser.includes("browser errors:"));
  const count = browser.split("pendingAttendanceCorrectionsThisPage:0,incompletePunchRecordsThisPage:0").length - 1;
  assert.equal(count, 2, "Both employer-switch fixtures must match current manager summary contract");
});

test("leave GET worker join verifies employer identity as well as worker primary key", () => {
  const route = readFileSync("src/app/api/leave/route.ts", "utf8");
  const read = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function POST("));
  assert.ok(read.includes("eq(leaveRequests.employeeId, employees.id)"));
  assert.ok(read.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(read.includes('if (access.role === "employee")'));
  assert.ok(!read.includes('if (user.role === "employee")'));
});
