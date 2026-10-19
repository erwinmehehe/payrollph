import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rememberWfmTimecardPeriod } from "../src/lib/workforce-manager-navigation";
import { WorkforcePlanner } from "../src/components/workspace/workforce-planner";
import {
  WorkforceWorkflowShortcuts,
  WORKFORCE_QUICK_TASKS,
} from "../src/components/workspace/workforce-workflow-shortcuts";
import type { DashboardData } from "../src/components/workspace/types";

const noop = () => {};
const fixture = {
  selectedOrganization: { id: 71, name: "Fictional WFM employer" },
  user: { id: 21 },
  access: { role: "manager", companyWide: false, orgUnitName: "Site A" },
  employees: [],
} as unknown as DashboardData;

test("WFM shortcuts link the four source-owned workflows without a second approval surface", () => {
  assert.deepEqual(WORKFORCE_QUICK_TASKS.map(item => item.tab),
    ["team", "coverage", "swaps", "timesheets"]);
  assert.equal(new Set(WORKFORCE_QUICK_TASKS.map(item => item.tab)).size, 4);
  const html = renderToStaticMarkup(createElement(WorkforceWorkflowShortcuts, {
    activeTab: "coverage", onNavigate: noop,
  }));
  assert.match(html, /aria-label="Workforce task shortcuts"/);
  for (const title of ["Weekly roster", "Coverage gaps", "Swap requests", "Timesheet review"]) {
    assert.ok(html.includes(title), title);
  }
  assert.match(html, /data-wfm-task="coverage" aria-pressed="true"/);
  assert.match(html, /data-wfm-task="team" aria-pressed="false"/);
  assert.match(html, /data-wfm-task="timesheets" aria-pressed="false"/);
  assert.match(html, /never publishes shifts, approves a timecard or releases payroll/);
  assert.doesNotMatch(html, /<form|action="\/api\/|type="submit"|Payroll ready|All approved/);
});

test("shortcuts are always reachable from Today but do not eagerly mount hidden mutation panels", () => {
  const html = renderToStaticMarkup(createElement(WorkforcePlanner, {
    data: fixture, notify: noop, canManage: false, onOpenAttendance: noop,
  }));
  assert.match(html, /id="wfm-tab-today"[^>]*aria-selected="true"/);
  assert.match(html, /data-wfm-workflow-shortcuts/);
  assert.match(html, /data-wfm-task="swaps" aria-pressed="false"/);
  assert.doesNotMatch(html, /data-wfm-team-roster|data-wfm-timesheets|data-wfm-coverage/);
});

test("WFM task navigation remembers the previous verified timesheet cutoff", () => {
  const first = { periodStart: "2026-09-16", periodEnd: "2026-09-30" };
  assert.deepEqual(rememberWfmTimecardPeriod(undefined, first), first);
  assert.equal(rememberWfmTimecardPeriod(first, undefined), first, "switching tools must not reset a cutoff");
  const next = { periodStart: "2026-10-01", periodEnd: "2026-10-15" };
  assert.deepEqual(rememberWfmTimecardPeriod(first, next), next);
  for (const invalid of [
    { periodStart: "", periodEnd: "2026-10-15" },
    { periodStart: "2026-10-31", periodEnd: "2026-10-15" },
    { periodStart: "2026-02-30", periodEnd: "2026-10-15" },
    { periodStart: "2026-10-01", periodEnd: "2026-13-01" },
  ]) {
    assert.equal(rememberWfmTimecardPeriod(first, invalid), first, JSON.stringify(invalid));
  }
  assert.deepEqual(rememberWfmTimecardPeriod(first, {
    periodStart: "2028-02-29", periodEnd: "2028-02-29",
  }), { periodStart: "2028-02-29", periodEnd: "2028-02-29" });
});

test("planner retains the period for quick actions and timesheet date edits", () => {
  const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");
  const timesheets = readFileSync("src/components/workspace/workforce-timesheet-panel.tsx", "utf8");
  assert.match(planner, /<WorkforceWorkflowShortcuts activeTab=\{workspaceTab\} onNavigate=\{openWorkforceTool\}/);
  assert.match(planner, /tab === "timesheets" && period/);
  assert.match(planner, /rememberWfmTimecardPeriod\(previous, period\)/);
  assert.match(planner, /onPeriodChange=\{rememberTimesheetPeriod\}/);
  assert.match(planner, /props\.data\.user\?\.id/);
  assert.match(timesheets, /onPeriodChange\?\.\(\{ periodStart: nextStart, periodEnd \}\)/);
  assert.match(timesheets, /onPeriodChange\?\.\(\{ periodStart, periodEnd: nextEnd \}\)/);
  assert.match(planner, /workspaceTab === "coverage" && <WorkforceCoveragePanel/);
  assert.match(planner, /workspaceTab === "swaps" && <WorkforceScheduleSwapPanel/);
  assert.match(planner, /workspaceTab === "timesheets" && <WorkforceTimesheetPanel/);
});
