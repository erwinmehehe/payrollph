import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceShell } from "../src/components/workspace/shell";
import { NAVIGATION, tenantNavigationGroups } from "../src/components/workspace/nav";
import { workspacePagesForRole } from "../src/lib/workspace-role-ui";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { loadTenantModulePreferences } from "../src/lib/tenant-modules";
import { dashboardFixture } from "./fixtures/dashboard-ui";

const options = { enabled: true, mode: "core", enabledModules: [], canManageModules: true, companyWide: true };

test("flag-off reads no optional columns and enabled preferences stay tenant scoped", async () => {
  let calls = 0;
  const read = async () => { calls++; return [
    { id: 1, mode: "core", enabledModules: ["spend", "unknown", 1] },
    { id: 2, mode: "all", enabledModules: [] },
    { id: 999, mode: "core", enabledModules: ["it"] },
  ]; };
  for (const env of [{}, { CORE_MODULE_NAVIGATION_ENABLED: "false" }, { CORE_MODULE_NAVIGATION_ENABLED: "TRUE" }]) {
    assert.equal((await loadTenantModulePreferences([1, 2], read, env)).size, 0);
  }
  assert.equal(calls, 0);
  const rows = await loadTenantModulePreferences([1, 2], read, { CORE_MODULE_NAVIGATION_ENABLED: "true" });
  assert.deepEqual([...rows], [
    [1, { mode: "core", enabledModules: ["spend"] }],
    [2, { mode: "all", enabledModules: [] }],
  ]);
  assert.equal(calls, 1);
});
function snapshot(mode: string, enabled = true, modules: string[] = []) {
  const groups = tenantNavigationGroups({ ...options, enabled, mode, enabledModules: modules });
  const pages = groups.flatMap(g => g.items.map(i => i.name));
  const data = { ...dashboardFixture, access: { role: "owner", companyWide: true, orgUnitName: null }, coreModuleNavigationEnabled: enabled, selectedOrganization: { ...dashboardFixture.selectedOrganization, moduleNavigationMode: mode, enabledModules: modules } };
  const html = renderToStaticMarkup(createElement(WorkspaceShell, { data, page: "Overview", onPage: () => {}, notifications: [], onOpenPalette: () => {}, onSwitchClient: () => {}, onSignOut: () => {}, workspaceRole: "owner", visiblePages: pages }, null));
  const names = [...html.matchAll(/data-nav-name="([^"]+)"/g)].map(m => m[1].replaceAll("&amp;", "&"));
  if (/class="sidebar-settings-link/.test(html)) names.push("Settings");
  return { pages, names };
}

test("snapshot: a new tenant shows core navigation and no optional operations", () => {
  assert.deepEqual(snapshot("core").pages, ["Overview", "Payroll", "People", "Time & attendance", "Approvals", "Reports", "Settings", "More modules"]);
  const actual = snapshot("core");
  for (const page of ["People", "Time & attendance", "Payroll", "Reports", "Settings", "More modules"]) assert.ok(actual.names.includes(page), page);
  for (const page of ["Expenses", "Assets", "Automation", "Recruitment", "Developer"]) assert.ok(!actual.names.includes(page), page);
});

test("snapshot: existing tenants and flag-off tenants retain the exact previous inventory", () => {
  const previous = NAVIGATION.flatMap(g => g.items.map(i => i.name));
  assert.deepEqual(snapshot("all").pages, previous);
  assert.deepEqual(snapshot("core", false).pages, previous);
  assert.deepEqual(tenantNavigationGroups({ ...options, mode: undefined }).flatMap(g => g.items.map(i => i.name)), previous);
});

test("opt-ins disclose only chosen pages and never expand role or freelancer access", () => {
  const enabled = snapshot("core", true, ["spend", "it"]).pages;
  assert.ok(enabled.includes("Expenses") && enabled.includes("Assets"));
  assert.ok(!enabled.includes("Automation"));
  const checker = tenantNavigationGroups({ ...options, enabledModules: ["spend", "automation"], rolePages: workspacePagesForRole("checker"), canManageModules: false }).flatMap(g => g.items.map(i => i.name));
  assert.deepEqual(checker, ["Overview", "Approvals"]);
  const scoped = tenantNavigationGroups({ ...options, companyWide: false }).flatMap(g => g.items.map(i => i.name));
  assert.ok(!scoped.includes("More modules"));
  const solo = tenantNavigationGroups({ ...options, isFreelancer: true }).flatMap(g => g.items.map(i => i.name));
  assert.ok(!solo.includes("People") && !solo.includes("More modules"));
  assert.equal(criticalReleaseFlagEnabled("coreModuleNavigation", {}), false);
});
