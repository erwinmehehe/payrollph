import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PILOT_CORE_PAGES, pilotCoreNavigationPages, pilotFocusEnabledForOrganization } from "../src/lib/pilot-navigation";
import { NAVIGATION, FREELANCER_HIDDEN } from "../src/components/workspace/nav";
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

test("pilot flag originates on server and workspace filters existing role-allowed pages", () => {
  const server = readFileSync("src/app/app/page.tsx", "utf8");
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  assert.ok(server.includes("pilotFocusEnabledForOrganization(companyOrganizationId)"));
  assert.ok(server.includes("pilotFocusEnabled={pilotFocusEnabled}"));
  assert.ok(workspace.includes("pilotCoreNavigationPages(roleAllowedPages)"));
  assert.ok(workspace.includes("!rolePages || rolePages.includes(name)"));
  assert.ok(server.includes("!pilotFocusEnabled && process.env.NEXT_PUBLIC_HCM_MY_TEAM_ENABLED"));
});
