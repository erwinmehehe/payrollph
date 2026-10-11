import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HRIS_HOME_SHORTCUTS, hrisHomeShortcutsForRole } from "../src/lib/hris-home-shortcuts";
import { PILOT_CORE_PAGES, pilotCoreNavigationPages } from "../src/lib/pilot-navigation";
import { NAVIGATION } from "../src/components/workspace/nav";
import { workspacePagesForRole } from "../src/lib/workspace-role-ui";

const fullMenu = NAVIGATION.flatMap((group) => group.items).map((item) => item.name);

test("HRIS hub is only offered to People administration roles", () => {
  for (const role of ["owner", "admin", "hr"]) {
    assert.ok(hrisHomeShortcutsForRole(role, fullMenu).length > 0, role);
  }
  for (const role of ["bookkeeper", "payroll", "checker", "manager", "employee", "unknown", null]) {
    assert.deepEqual(hrisHomeShortcutsForRole(role, fullMenu), [], String(role));
  }
});

test("shortcuts use existing pages and never bypass restricted role or pilot navigation", () => {
  assert.equal(new Set(HRIS_HOME_SHORTCUTS.map((action) => action.id)).size, HRIS_HOME_SHORTCUTS.length);
  assert.equal(new Set(HRIS_HOME_SHORTCUTS.map((action) => action.page)).size, HRIS_HOME_SHORTCUTS.length);
  assert.ok(HRIS_HOME_SHORTCUTS.every((action) => fullMenu.includes(action.page)));
  const hrAllowed = workspacePagesForRole("hr")!;
  const hrActions = hrisHomeShortcutsForRole("hr", hrAllowed);
  assert.ok(hrActions.every((action) => hrAllowed.includes(action.page)));
  assert.ok(hrActions.some((action) => action.id === "hiring"));
  assert.ok(hrActions.some((action) => action.id === "documents"));
  assert.ok(hrActions.some((action) => action.id === "performance"));

  const pilotAllowed = pilotCoreNavigationPages(hrAllowed);
  const pilot = hrisHomeShortcutsForRole("hr", pilotAllowed);
  assert.deepEqual(pilot.map((action) => action.page), [
    "People", "Leave", "Time & attendance", "Approvals",
  ]);
  assert.ok(pilot.every((action) => PILOT_CORE_PAGES.some((page) => page === action.page)));
  assert.deepEqual(hrisHomeShortcutsForRole("hr", ["Payroll"]), []);
  assert.deepEqual(hrisHomeShortcutsForRole("hr", []), []);
});

test("HR dashboard only navigates to the exact selected, authorized employee", () => {
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  const roleView = readFileSync("src/components/workspace/role-overview.tsx", "utf8");
  const v2 = readFileSync("src/components/workspace/role-overview-v2.tsx", "utf8");
  const people = readFileSync("src/components/workspace/people.tsx", "utf8");
  assert.ok(workspace.includes("hrisHomeShortcutsForRole(effectiveRole, availablePages)"));
  assert.ok(workspace.includes("<HrisHomeShortcuts"));
  assert.ok(workspace.includes("actions={hrisShortcuts}"));
  assert.ok(workspace.includes("onOpenEmployee={canUsePeopleOps ? openHrEmployee : undefined}"));
  assert.ok(workspace.includes("canUsePeopleOps"));
  assert.ok(workspace.includes("data.employees.some((employee) => employee.id === employeeId)"));
  assert.ok(workspace.includes("setFocusEmployeeId(employeeId)"));
  assert.ok(workspace.includes('setPage("People")'));
  assert.ok(workspace.includes("onFocusEmployee={openHrEmployee}"));
  assert.ok(roleView.includes("onFocusEmployee={onFocusEmployee}"));
  assert.ok(v2.includes("onFocusEmployee(employee.id)"));
  assert.ok(people.includes("employee.id === focusEmployeeId"));
  assert.ok(people.includes("onClearFocus?.()"));
  const shortcuts = readFileSync("src/components/hris-home-shortcuts.tsx", "utf8");
  assert.ok(shortcuts.includes('type="button"'));
  assert.ok(shortcuts.includes('onClick={() => onPage(action.page)}'));
  assert.ok(!shortcuts.includes("fetch("));
});
