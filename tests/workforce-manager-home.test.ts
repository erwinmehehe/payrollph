import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkforcePlanner } from "../src/components/workspace/workforce-planner";
import { WorkforceManagerHome } from "../src/components/workspace/workforce-manager-home";
import { WorkforceTimesheetPanel } from "../src/components/workspace/workforce-timesheet-panel";
import type { DashboardData } from "../src/components/workspace/types";

const data = {
  selectedOrganization: { id: 11, name: "Fictional employer" }, employees: [],
  access: { role: "hr", companyWide: true, orgUnitName: null }, user: { id: 101 },
} as unknown as DashboardData;
const noop = () => {};

test("initial manager workspace presents Today without mounting hidden roster or mutation panels", () => {
  const html = renderToStaticMarkup(createElement(WorkforcePlanner, {
    data, notify: noop, canManage: true, onOpenAttendance: noop,
  }));
  assert.match(html, /id="wfm-tab-today"[^>]*aria-selected="true"/);
  assert.match(html, /Weekly roster/);
  assert.match(html, /Approvals/);
  assert.match(html, /data-wfm-manager-home="today"/);
  assert.doesNotMatch(html, /data-wfm-team-roster|data-wfm-roster-batch-checker/);
  assert.doesNotMatch(html, /Shift swaps|Overtime authorization/);
  assert.match(html, /Loading authorized WFM sources/);
  assert.doesNotMatch(html, /No triage signals/);
});

test("approval hub exposes source reviews without inventing totals or bypassing a disabled batch pilot", () => {
  const html = renderToStaticMarkup(createElement(WorkforceManagerHome, {
    organizationId: 11, mode: "approvals", canReviewBatches: false,
    onOpenTab: noop, onOpenAttendance: noop,
  }));
  for (const label of ["Open-shift claims", "Schedule swaps", "Overtime requests", "Timesheet review", "Attendance corrections"]) {
    assert.ok(html.includes(label));
  }
  assert.doesNotMatch(html, /Roster batch review|data-wfm-live-floor/);
  assert.match(html, /Loading authorized WFM sources/);
  assert.doesNotMatch(html, /No triage signals/);
});

test("timesheet source opens with the exact cutoff passed by manager triage", () => {
  const html = renderToStaticMarkup(createElement(WorkforceTimesheetPanel, {
    data, notify: noop, canManage: true,
    initialPeriod: { periodStart: "2026-09-16", periodEnd: "2026-09-30" },
  }));
  assert.match(html, /value="2026-09-16"/);
  assert.match(html, /value="2026-09-30"/);
});
