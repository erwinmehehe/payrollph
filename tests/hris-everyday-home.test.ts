import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hrisHomeShortcutsForRole } from "../src/lib/hris-home-shortcuts";
import { enterpriseHcmPlanGateEnabled, evaluateEnterpriseHcmPlan } from "../src/lib/hcm-enterprise-plan-policy";

const read = (path: string) => readFileSync(path, "utf8");

test("daily HR tasks stay primary; secondary HR tools are collapsed", () => {
  const actions = hrisHomeShortcutsForRole("hr", [
    "People", "Recruitment", "Documents", "Leave", "Time & attendance", "Approvals",
    "Performance", "Analytics",
  ]);
  const daily = new Set(["directory", "hiring", "leave", "approvals"]);
  assert.deepEqual(actions.filter(a => daily.has(a.id)).map(a => a.id), [
    "directory", "hiring", "leave", "approvals",
  ]);
  const view = read("src/components/hris-home-shortcuts.tsx");
  assert.ok(view.includes('const dailyActions = actions.filter'));
  assert.ok(view.includes('const additionalActions = actions.filter'));
  assert.ok(view.includes('{dailyActions.map((action) => {'));
  assert.ok(view.includes('<details className="mt-5'));
  assert.ok(view.includes('More HR tools'));
  assert.ok(view.includes('Review team'));
  assert.ok(view.includes('reviewTeamHref &&'));
  assert.ok(view.includes('onClick={() => onPage(action.page)}'));
  assert.ok(!view.includes('fetch('));
});

test("review-team destination is derived only from existing server side role and flag gate", () => {
  const app = read("src/app/app/page.tsx");
  const workspace = read("src/components/linaw-workspace.tsx");
  assert.ok(app.includes('const canSeeMyTeam = !pilotFocusEnabled'));
  assert.ok(app.includes('process.env.HCM_MY_TEAM_ENABLED === "true"'));
  assert.ok(app.includes('process.env.NEXT_PUBLIC_HCM_MY_TEAM_ENABLED === "true"'));
  assert.ok(app.includes('reviewTeamHref={canSeeMyTeam ? "/hcm/my-team?organizationId=" + data.selectedOrganization.id : null}'));
  assert.ok(workspace.includes('reviewTeamHref={reviewTeamHref}'));
  assert.ok(workspace.includes('key={data.selectedOrganization.id}'));
  assert.ok(workspace.includes('employees={canUsePeopleOps ? data.employees : []}'));
  assert.ok(workspace.includes('onOpenEmployee={canUsePeopleOps ? openHrEmployee : undefined}'));
  const team = read("src/app/hcm/my-team/page.tsx");
  assert.ok(team.includes('assertOrganizationRole('));
  assert.ok(team.includes('deriveMyTeamScope(access)'));
  assert.ok(team.includes('key={organizationId}'));
});

test("secondary shortcuts and employee search still inherit authorization", () => {
  assert.deepEqual(hrisHomeShortcutsForRole("manager", ["People", "Leave"]), []);
  assert.deepEqual(hrisHomeShortcutsForRole("hr", ["Leave"]).map(a => a.id), ["leave"]);
  const workspace = read("src/components/linaw-workspace.tsx");
  assert.ok(workspace.includes('hrisHomeShortcutsForRole(effectiveRole, availablePages)'));
  assert.ok(workspace.includes('data.employees.some((employee) => employee.id === employeeId)'));
  const app = read("src/app/app/page.tsx");
  assert.ok(app.includes('data.selectedOrganization.id'));
});

test("Everyday HR direct hire opens the existing role-gated employee workflow", () => {
  const checklist = read("src/components/hris-onboarding-checklist.tsx");
  const workspace = read("src/components/linaw-workspace.tsx");
  assert.ok(checklist.includes("Add employee &amp; start onboarding"));
  assert.ok(checklist.includes("onClick={onAddEmployee}"));
  assert.ok(workspace.includes("onAddEmployee={canUsePeopleOps && !demoRole ? () => setNewHireOpen(true) : undefined}"));
  assert.ok(workspace.includes("<NewHireModal"));
  assert.ok(workspace.includes("onCreated={async () => {"));
  // The shortcut is presentation-only; the existing POST /api/employees is the authority.
  assert.ok(!checklist.includes('fetch("/api/employees"'));
});

test("People Home does not lead enrolled Core HR into a paid Action Center dead end", () => {
  const optedIn = { HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true", HCM_ENTERPRISE_PLAN_GATE_ORG_IDS: "17" };
  const enterprise = {
    plan: "Enterprise", active: true, status: "active",
    features: ["advanced-hcm-discovery"],
  };
  assert.equal(enterpriseHcmPlanGateEnabled(17, optedIn), true);
  assert.equal(enterpriseHcmPlanGateEnabled(18, optedIn), false);
  assert.equal(evaluateEnterpriseHcmPlan(17, enterprise, optedIn), "allowed");
  assert.equal(evaluateEnterpriseHcmPlan(17,
    { ...enterprise, plan: "Core", features: [] }, optedIn), "enterprise-required");
  assert.equal(evaluateEnterpriseHcmPlan(17, null, optedIn), "entitlements-unavailable");
  assert.equal(evaluateEnterpriseHcmPlan(18, null, optedIn), "not-enforced");
  const page = read("src/app/hcm/command-center/page.tsx");
  const authorize = page.indexOf("assertOrganizationRole(");
  const showLink = page.indexOf("enterpriseHcmPlanGateEnabled(organizationId, process.env)");
  assert.ok(authorize >= 0 && showLink > authorize);
  assert.ok(page.includes("let actionCenterAvailable = !enterpriseHcmPlanGateEnabled(organizationId, process.env);"));
  assert.ok(page.includes('if (planDecision === "allowed") actionCenterAvailable = true;'));
  assert.ok(page.includes("{hasPeopleWorkspace && actionCenterAvailable && ("));
  assert.ok(page.includes("Open HCM Action Center"));
  assert.ok(page.includes("My HCM decisions"), "Assigned source work must remain on the everyday home");
});
