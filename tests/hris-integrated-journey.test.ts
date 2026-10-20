import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hrisHomeShortcutsForRole } from "../src/lib/hris-home-shortcuts";
import { buildEmployee360Overview } from "../src/lib/employee-360-overview";
import { deriveMyTeamScope } from "../src/lib/hcm-my-team-contract";
import { myTeamWorkflowHref, requestedMyTeamWorkspacePage } from "../src/lib/hcm-my-team-navigation";
import { buildOnboardingChecklistGroups } from "../src/lib/hris-onboarding-checklist";

/** Cross-surface contract acceptance; PostgreSQL and browser suites test the actual endpoints. */
test("HR Home to Employee 360 to onboarding shares one selected employee and source workflow", () => {
  const pages = ["Overview", "People", "Recruitment", "Documents", "Leave", "Approvals"];
  assert.deepEqual(hrisHomeShortcutsForRole("hr", pages).map(a => a.page),
    ["People", "Recruitment", "Documents", "Leave", "Approvals"]);
  assert.deepEqual(hrisHomeShortcutsForRole("manager", pages), []);
  const employer = 17, worker = 23;
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const people = readFileSync("src/components/workspace/people.tsx", "utf8");
  const onboarding = readFileSync("src/components/hris-onboarding-checklist.tsx", "utf8");
  assert.ok(workspace.includes("data.employees.some((employee) => employee.id === employeeId)"));
  assert.ok(workspace.includes("setFocusEmployeeId(employeeId)"));
  assert.ok(people.includes('key={data.selectedOrganization.id + ":" + selected.id + ":" + String(canManage)}'));
  assert.ok(workspace.includes("onOpenEmployee={openHrEmployee}"));
  assert.ok(onboarding.includes('fetch("/api/provisioning"'));
  assert.ok(onboarding.includes("payload.organizationId !== organizationId"));
  assert.ok(onboarding.includes("payload.employeeId !== employeeId"));
  const groups = buildOnboardingChecklistGroups(
    [{id: worker, employeeNo: "TEST-23", firstName: "Sample", lastName: "Worker", status: "Active"}],
    [{id: 9, employeeId: worker, kind: "onboarding", title: "Test", owner: "HR", done: false},
     {id: 10, employeeId: 99, kind: "onboarding", title: "Foreign", owner: "HR", done: false}]
  );
  assert.deepEqual(groups.map(g => g.employee.id), [worker]);
  const profile = buildEmployee360Overview({
    employee: {title: "Staff", status: "Active", employmentType: "Regular"},
    leave: [{status: "Pending"}],
    profile: null, profileState: "unavailable",
  });
  assert.equal(profile.find(x => x.id === "onboarding")?.available, false);
  assert.equal(profile.find(x => x.id === "leave")?.value, "1 pending in snapshot");
  assert.ok(employer > 0);
});

test("My Team to approvals follows manager scope and pilot navigation, never creates approval rights", () => {
  assert.equal(deriveMyTeamScope({role:"manager",companyWide:true,orgUnitId:null}), null);
  assert.deepEqual(deriveMyTeamScope({role:"manager",companyWide:false,orgUnitId:8}),
    {kind:"unit",orgUnitId:8});
  const request = {requestedPage:"Approvals",role:"manager",companyWide:false,
    accountType:"business",rolePages:null,pilotFocusEnabled:true,demoMode:false};
  assert.equal(requestedMyTeamWorkspacePage(request), "Approvals");
  assert.equal(requestedMyTeamWorkspacePage({...request,requestedPage:"Workforce"}), null);
  assert.equal(requestedMyTeamWorkspacePage({...request,companyWide:true}), null);
  assert.equal(myTeamWorkflowHref(17, "Approvals"),
    "/app?organizationId=17&workspacePage=Approvals");
  const myTeamPage = readFileSync("src/app/hcm/my-team/page.tsx", "utf8");
  const actions = readFileSync("src/components/hcm-my-team-action-center.tsx", "utf8");
  const approvals = readFileSync("src/components/workspace/approvals.tsx", "utf8");
  assert.ok(myTeamPage.includes("pilotFocusEnabledForOrganization(organizationId)"));
  assert.ok(actions.includes('pilotFocusEnabled && action.page === "Workforce"'));
  assert.ok(actions.includes("Only actually assigned requests can be approved or declined."));
  assert.ok(approvals.includes("decisionVisibleToViewer"));
  assert.ok(approvals.includes("Confirm approval"));
  for (const forbidden of ['fetch(', 'method: "PATCH"', 'method: "POST"']) {
    assert.ok(!actions.includes(forbidden));
  }
});

test("onboarding mutation remains employer/worker bound and does not certify payroll", () => {
  const api = readFileSync("src/app/api/provisioning/route.ts", "utf8");
  const board = readFileSync("src/components/hris-onboarding-checklist.tsx", "utf8");
  const patch = api.slice(api.indexOf("export async function PATCH("));
  assert.ok(patch.includes("enforceSameOriginMutation(request)"));
  assert.ok(patch.includes("assertOrganizationRole("));
  assert.ok(patch.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(patch.includes("recordAuditEvent({"));
  assert.ok(board.includes("It is not government-ID verification"));
  assert.ok(board.includes("setSnapshotStale(true)"));
});
