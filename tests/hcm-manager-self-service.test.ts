import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MY_TEAM_WORKFLOW_PAGES,
  myTeamWorkflowHref,
  requestedMyTeamWorkspacePage,
} from "../src/lib/hcm-my-team-navigation";

const permitted = {
  role: "manager",
  companyWide: false,
  accountType: "business",
  pilotFocusEnabled: false,
  demoMode: false,
  rolePages: null,
};

test("manager action links resolve only four existing governed workspaces", () => {
  assert.deepEqual([...MY_TEAM_WORKFLOW_PAGES], [
    "Leave", "Time & attendance", "Workforce", "Approvals",
  ]);
  assert.equal(myTeamWorkflowHref(13, "Leave"), "/app?organizationId=13&workspacePage=Leave");
  assert.equal(myTeamWorkflowHref(13, "Time & attendance"),
    "/app?organizationId=13&workspacePage=Time%20%26%20attendance");
  assert.equal(myTeamWorkflowHref(13, "Approvals"), "/app?organizationId=13&workspacePage=Approvals");
  assert.equal(myTeamWorkflowHref(0, "Leave"), null);
  assert.equal(myTeamWorkflowHref(-5, "Leave"), null);
  assert.equal(myTeamWorkflowHref(1.7, "Leave"), null);
  assert.equal(myTeamWorkflowHref(Number.MAX_SAFE_INTEGER + 1, "Leave"), null);
  assert.equal(myTeamWorkflowHref(13, "Payroll" as "Leave"), null);
});

test("deep links cannot open arbitrary role or freelancer pages", () => {
  for (const page of MY_TEAM_WORKFLOW_PAGES) {
    assert.equal(requestedMyTeamWorkspacePage({ ...permitted, requestedPage: page }), page);
  }
  for (const requestedPage of ["Payroll", "People", "Documents", "Enterprise", "Settings", "", "Not real", null]) {
    assert.equal(requestedMyTeamWorkspacePage({ ...permitted, requestedPage }), null);
  }
  for (const role of ["employee", "payroll", "bookkeeper", "checker", "unknown", null]) {
    assert.equal(requestedMyTeamWorkspacePage({ ...permitted, role, requestedPage: "Approvals" }), null);
  }
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, companyWide: true, requestedPage: "Approvals" }), null);
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, companyWide: null, requestedPage: "Approvals" }), null);
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, accountType: "freelancer", requestedPage: "Approvals" }), null);
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, demoMode: true, requestedPage: "Approvals" }), null);
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, requestedPage: "Leave", rolePages: ["Overview", "Approvals"] }), null);
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, requestedPage: "Approvals", rolePages: ["Overview", "Approvals"] }), "Approvals");
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, requestedPage: "Workforce", pilotFocusEnabled: true }), null);
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, requestedPage: "Approvals", pilotFocusEnabled: true }), "Approvals");
  assert.equal(requestedMyTeamWorkspacePage({ ...permitted, role: "hr", companyWide: true, requestedPage: "Leave" }), "Leave");
});

test("My Team actions are navigation only, not another HR approval endpoint", () => {
  const app = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const team = readFileSync("src/components/hcm-my-team.tsx", "utf8");
  const actionCenter = readFileSync("src/components/hcm-my-team-action-center.tsx", "utf8");
  const api = readFileSync("src/app/api/hcm/my-team/route.ts", "utf8");

  assert.ok(app.includes('searchParams.get("workspacePage") === "People"'), "Preserve existing People focus routing");
  assert.ok(app.includes("requestedMyTeamWorkspacePage({"));
  // Preserve manager navigation precedence while permitting separately gated HR review return links.
  assert.ok(app.includes('linkedTeamWorkflowPage ?? linkedHirePayrollPage ?? "Overview"'));
  assert.ok(app.includes("allowHirePayrollReview && !pilotFocusEnabled && !demoRole"));
  assert.ok(actionCenter.includes("myTeamWorkflowHref(organizationId, action.page)"));
  assert.ok(actionCenter.includes("Only actually assigned requests can be approved or declined."));
  assert.ok(actionCenter.includes("All counts are limited to this directory page"));
  assert.ok(actionCenter.includes('actions.filter((action) => !(pilotFocusEnabled && action.page === "Workforce"))'));
  const myTeamPage = readFileSync("src/app/hcm/my-team/page.tsx", "utf8");
  assert.ok(myTeamPage.includes("pilotFocusEnabledForOrganization(organizationId)"));
  assert.ok(team.includes("pilotFocusEnabled={pilotFocusEnabled}"));
  assert.ok(team.includes("pendingAttendanceCorrectionsThisPage"));
  assert.ok(team.includes("incompletePunchRecordsThisPage"));
  assert.ok(team.includes("validMyTeamResponse(payload, organizationId, cursor, searchQuery, statusFilter)"));
  assert.ok(team.includes("stored?.scopeKey === scopeKey"));
  assert.ok(api.includes('HCM_MY_TEAM_ENABLED !== "true"'));
  assert.ok(api.includes("deriveMyTeamScope(access)"));
  for (const forbidden of ['fetch(', 'method: "POST"', 'method: "PATCH"', 'onDecide(', 'setTaskDone(']) {
    assert.ok(!actionCenter.includes(forbidden), "Action center must not mutate: " + forbidden);
  }
});
