import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("My Team workflow navigation preserves its allowlist through tenant and pilot menus", async () => {
  const { requestedMyTeamWorkspacePage, myTeamWorkflowHref } = await import("../src/lib/hcm-my-team-navigation");
  const { tenantNavigationPages } = await import("../src/components/workspace/nav");
  const { workspacePagesForRole } = await import("../src/lib/workspace-role-ui");
  const rolePages = workspacePagesForRole("hr");
  for (const mode of ["all", "core"]) {
    const pages = tenantNavigationPages({ enabled: true, mode, rolePages }, true);
    const input = { role: "hr", companyWide: true, accountType: "business", rolePages: pages, pilotFocusEnabled: true, demoMode: false };
    assert.equal(requestedMyTeamWorkspacePage({ ...input, requestedPage: "Approvals" }), "Approvals");
    assert.equal(requestedMyTeamWorkspacePage({ ...input, requestedPage: "Time & attendance" }), "Time & attendance");
    assert.equal(requestedMyTeamWorkspacePage({ ...input, requestedPage: "Workforce" }), null);
    assert.equal(requestedMyTeamWorkspacePage({ ...input, requestedPage: "Enterprise" }), null);
    assert.equal(requestedMyTeamWorkspacePage({ ...input, requestedPage: "Approvals", role: "employee" }), null);
  }
  assert.equal(myTeamWorkflowHref(1, "Approvals"), "/app?organizationId=1&workspacePage=Approvals");
  assert.equal(myTeamWorkflowHref(0, "Approvals"), null);
});

test("standalone HCM browser tests retain the calendar's disabled flags and manager counts", () => {
  const browser = readFileSync("scripts/hcm-request-lifecycle-browser.mjs", "utf8");
  assert.ok(browser.includes('process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ENABLED'));
  assert.ok(browser.includes('process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ORG_IDS'));
  assert.ok(browser.includes("browser errors:"));
  // Inspect only the two original employer-switch completions, not the new
  // reusable synthetic team factory used by the additional browser regressions.
  const employerSwitchFixtures = browser.split("\n").filter((line) =>
    line.includes('await complete(await requestId("my-team?organizationId=2"), {organizationId:2,query:"",statusFilter:"all"'),
  );
  assert.equal(employerSwitchFixtures.length, 2, "Both employer-switch fixtures must remain covered");
  for (const fixture of employerSwitchFixtures) {
    assert.ok(fixture.includes('scope:{kind:"company",orgUnitId:null}'),
      "Employer-switch response must include its authorized company scope");
    assert.ok(fixture.includes("pendingAttendanceCorrectionsThisPage:0,incompletePunchRecordsThisPage:0"),
      "Employer-switch response must match current manager summary contract");
    assert.ok(fixture.includes('warning:"Fictional safe-empty team page"'),
      "Employer-switch response must carry the required source warning");
  }
});

test("leave GET worker join verifies employer identity as well as worker primary key", () => {
  const route = readFileSync("src/app/api/leave/route.ts", "utf8");
  const read = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function POST("));
  assert.ok(read.includes("eq(leaveRequests.employeeId, employees.id)"));
  assert.ok(read.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(read.includes('if (access.role === "employee")'));
  assert.ok(!read.includes('if (user.role === "employee")'));
});
