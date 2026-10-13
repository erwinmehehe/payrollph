import assert from "node:assert/strict";
import test from "node:test";
import { PILOT_CORE_PAGES, pilotCoreNavigationPages, pilotFocusEnabledForOrganization } from "../src/lib/pilot-navigation";
import { NAVIGATION, FREELANCER_HIDDEN, tenantNavigationPages } from "../src/components/workspace/nav";
import { workspacePagesForRole } from "../src/lib/workspace-role-ui";

test("pilot focus is disabled for every org unless enabled AND individually allowed", () => {
  assert.equal(pilotFocusEnabledForOrganization(5, {}), false);
  const enabled = { PILOT_FOCUS_NAV_ENABLED: "true", PILOT_FOCUS_ORG_IDS: "5, 9" };
  assert.equal(pilotFocusEnabledForOrganization(5, enabled), true);
  assert.equal(pilotFocusEnabledForOrganization(6, enabled), false);
  assert.equal(pilotFocusEnabledForOrganization(0, enabled), false);
  assert.equal(pilotFocusEnabledForOrganization(5, { ...enabled, PILOT_FOCUS_NAV_ENABLED: "false" }), false);
  assert.equal(pilotFocusEnabledForOrganization(5, { ...enabled, PILOT_FOCUS_ORG_IDS: "50" }), false);
});

test("pilot menu includes core payroll pages only and cannot add pages to a restricted role", () => {
  const available = NAVIGATION.flatMap((group) => group.items).map((item) => item.name);
  assert.deepEqual(pilotCoreNavigationPages(available), [...PILOT_CORE_PAGES]);
  for (const role of ["hr", "payroll", "checker", "bookkeeper"]) {
    const roleAccess = workspacePagesForRole(role)!;
    const reduced = pilotCoreNavigationPages(roleAccess);
    assert.ok(reduced.every((page) => roleAccess.includes(page)), role);
  }
  assert.equal(pilotCoreNavigationPages(["Overview", "Automation", "Earned wage", "Performance"]).join(), "Overview");
  assert.equal(PILOT_CORE_PAGES.includes("Payroll"), true);
  assert.ok(!PILOT_CORE_PAGES.includes("Automation" as never));
  assert.ok(FREELANCER_HIDDEN.has("Payroll"));
});

test("legacy pilot navigation intersects roles while tenant core opt-ins remain reachable", () => {
  for (const role of ["hr", "payroll", "checker", "bookkeeper"]) {
    const rolePages = workspacePagesForRole(role)!;
    const pilot = tenantNavigationPages({ enabled: true, mode: "all", rolePages }, true);
    assert.ok(pilot.every(page => rolePages.includes(page)), role);
    assert.ok(!pilot.includes("Automation") && !pilot.includes("Expenses"));
    if (rolePages.includes("Approvals")) assert.ok(pilot.includes("Approvals"));
  }
  const core = tenantNavigationPages({ enabled: true, mode: "core", enabledModules: ["spend"], canManageModules: true, companyWide: true }, true);
  assert.ok(core.includes("Reports") && core.includes("More modules") && core.includes("Expenses"));
  assert.ok(!core.includes("Automation"));
});
