import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceShell } from "../src/components/workspace/shell";
import type { DashboardData } from "../src/components/workspace/types";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("actual workspace shell flag-off markup equals absent-flag markup", () => {
  const previous = (globalThis as typeof globalThis & { React?: typeof React }).React;
  Object.assign(globalThis, { React });
  const organization = { id: 1, name: "Synthetic organization", accountType: "company" };
  const data = { selectedOrganization: organization, organizations: [organization],
    tasks: [], employees: [], auditEvents: [], complianceActions: [], payrollRuns: [],
    punches: [], leaveRequests: [], user: null, access: null } as unknown as DashboardData;
  const render = (enabled?: boolean) => renderToStaticMarkup(React.createElement(WorkspaceShell, {
    data: { ...data, compactMobileHeaderEnabled: enabled }, page: "People", notifications: [],
    onPage: () => {}, onOpenPalette: () => {}, onSwitchClient: () => {}, onSignOut: () => {},
  }));
  try {
    assert.equal(render(false), render());
    assert.doesNotMatch(render(false), /data-compact-mobile-header/);
    assert.match(render(true), /data-compact-mobile-header="true"/);
    assert.equal(criticalReleaseFlagEnabled("compactMobileHeader", {}), false);
    assert.equal(criticalReleaseFlagEnabled("compactMobileHeader", { COMPACT_MOBILE_HEADER_ENABLED: "TRUE" }), false);
    assert.equal(criticalReleaseFlagEnabled("compactMobileHeader", { COMPACT_MOBILE_HEADER_ENABLED: "true" }), true);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Object.assign(globalThis, { React: previous });
  }
});
