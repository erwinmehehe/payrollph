import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveWorkforcePayrollHandoff as resolve,
  verifiedWorkforceTimesheetCounts,
} from "../src/lib/workforce-payroll-handoff";
import { firstPayrollRunHref, resolveFirstPayrollRunFocus } from "../src/lib/first-payroll-run-navigation";
import { WorkforceTimesheetPanel } from "../src/components/workspace/workforce-timesheet-panel";
import type { DashboardData } from "../src/components/workspace/types";

const period = { periodStart: "2026-10-01", periodEnd: "2026-10-15" };
const run = (id = 42, overrides: Record<string, unknown> = {}) => ({
  id, organizationId: 71, legalEntityId: null, periodStart: period.periodStart,
  periodEnd: period.periodEnd, periodLabel: "October A", scopeLabel: "Entire company",
  status: "draft", ...overrides,
});
const snapshot = () => ({
  policy: { active: true, enforcementMode: "block" }, manager: true,
  employees: [
    { id: 1, employeeNo: "FICTION-001", name: "Fictional Ada", orgUnitId: null },
    { id: 2, employeeNo: "FICTION-002", name: "Fictional Bea", orgUnitId: 7 },
  ],
  latest: [
    { id: 9, employeeId: 1, ...period, status: "approved", blockerCount: 0 },
    { id: 10, employeeId: 2, ...period, status: "stale", blockerCount: 2 },
  ],
  history: [],
  expectations: [{ id: 8, payrollRunId: 42, employeeId: 2, ...period, status: "expected" }],
});
type HandoffInput = Parameters<typeof resolve>[0];
const input = (changes: Partial<HandoffInput> = {}): HandoffInput => ({
  organizationId: 71, viewerId: 81, access: { role: "payroll", companyWide: true },
  connectedNavigationEnabled: true, period, timesheetResponse: snapshot(),
  payrollRuns: [run()], selectedLegalEntityId: null, ...changes,
});

test("only exact cutoff and currently authorized payroll run appear with scoped timecard facts", () => {
  const result = resolve(input());
  assert.equal(result.kind, "visible");
  if (result.kind !== "visible") return;
  assert.deepEqual(result.runs.map(item => item.id), [42]);
  assert.deepEqual(result.counts, {
    employees: 2, approved: 1, submitted: 0, stale: 1, expectedMissing: 1, blockers: 2,
  });
  const url = new URL(firstPayrollRunHref(71, result.runs[0].id), "https://example.test");
  assert.equal(resolveFirstPayrollRunFocus({
    enabled: true, demoMode: false, requestedPage: url.searchParams.get("workspacePage"),
    requestedOrganizationId: url.searchParams.get("organizationId"),
    requestedRunId: url.searchParams.get("focusPayrollRunId"),
    organizationId: 71, access: { role: "payroll", companyWide: true },
    authorizedRuns: [run(42)],
  }), 42);
});

test("multiple matching payroll runs are individually listed, not auto-selected", () => {
  const result = resolve(input({ payrollRuns: [run(42), run(43)] }));
  assert.equal(result.kind, "visible");
  if (result.kind !== "visible") return;
  assert.deepEqual(result.runs.map(item => item.id), [42, 43]);
  assert.notEqual(firstPayrollRunHref(71, 42), firstPayrollRunHref(71, 43));
});

test("nearby periods and missing runs do not assert that payroll is ready", () => {
  const result = resolve(input({ payrollRuns: [
    run(4, { periodStart: "2026-10-16", periodEnd: "2026-10-31" }),
  ] }));
  assert.equal(result.kind, "visible");
  if (result.kind === "visible") assert.deepEqual(result.runs, []);
});

test("company-wide payroll roles only; manager, HR, scoped review and role downgrade never see run IDs", () => {
  for (const access of [
    { role: "manager", companyWide: true }, { role: "hr", companyWide: true },
    { role: "employee", companyWide: true }, { role: "payroll", companyWide: false },
    { role: "checker", companyWide: false }, null,
  ]) assert.equal(resolve(input({ access })).kind, "restricted");
  assert.equal(resolve(input({ viewerId: null })).kind, "restricted");
  for (const role of ["owner", "admin", "bookkeeper", "payroll", "checker"]) {
    assert.equal(resolve(input({ access: { role, companyWide: true } })).kind, "visible");
  }
});

test("default-off connected navigation withholds deep links", () => {
  assert.equal(resolve(input({ connectedNavigationEnabled: false })).kind, "disabled");
});

test("foreign, missing, repeated employer/run identities and legal-entity mismatches fail closed", () => {
  for (const payrollRuns of [
    [run(42, { organizationId: 999 })], [run(42, { organizationId: undefined })],
    [run(42), run(42)], [run(42, { legalEntityId: 5 })],
  ]) {
    assert.equal(resolve(input({
      payrollRuns,
      selectedLegalEntityId: payrollRuns[0].legalEntityId === 5 ? 8 : null,
    })).kind, "unverified");
  }
  assert.equal(resolve(input({
    payrollRuns: [run(42, { legalEntityId: 8 })], selectedLegalEntityId: 8,
  })).kind, "visible");
});

test("invalid cutoffs including partial/reversed/impossible dates are unverified", () => {
  for (const selectedPeriod of [
    { periodStart: "", periodEnd: period.periodEnd },
    { periodStart: "2026-10-16", periodEnd: "2026-10-15" },
    { periodStart: "2026-02-30", periodEnd: "2026-10-15" },
    { periodStart: "2026-10-01", periodEnd: "2026-13-01" },
  ]) assert.equal(resolve(input({ period: selectedPeriod })).kind, "unverified");
});

test("malformed, partial, wrong-cutoff, duplicate and invalid attendance data never imply zero blockers", () => {
  const original = snapshot();
  for (const timesheetResponse of [
    null, {}, { ...original, policy: undefined }, { ...original, employees: null },
    { ...original, latest: null }, { ...original, history: null },
    { ...original, expectations: null },
    { ...original, latest: [{ ...original.latest[0], blockerCount: -1 }] },
    { ...original, latest: [{ ...original.latest[0], employeeId: 99 }] },
    { ...original, latest: [{ ...original.latest[0], periodEnd: "2026-10-31" }] },
    { ...original, latest: [original.latest[0], original.latest[0]] },
    { ...original, expectations: [{ ...original.expectations[0], status: "unknown" }] },
  ]) {
    assert.equal(verifiedWorkforceTimesheetCounts(timesheetResponse, period), null);
    assert.equal(resolve(input({ timesheetResponse })).kind, "unverified");
  }
  assert.deepEqual(verifiedWorkforceTimesheetCounts(snapshot(), period)?.blockers, 2);
});

test("malformed or foreign dashboard lists cannot be used to infer a safe run", () => {
  for (const payrollRuns of [
    null, undefined, [{ id: 42 }], [run(0)],
    [run(42, { periodStart: "2026-02-30" })], [run(42, { scopeLabel: null })],
  ]) assert.equal(resolve(input({ payrollRuns })).kind, "unverified");
});

test("wired UI renders no payroll-run action while data is loading; restricted roles omit handoff", () => {
  const data = {
    selectedOrganization: { id: 71, name: "Fictional employer" },
    user: { id: 81 }, access: { role: "payroll", companyWide: true },
    employees: [], payrollRuns: [run()], firstPayrollConnectedEnabled: true,
  } as unknown as DashboardData;
  const html = renderToStaticMarkup(createElement(WorkforceTimesheetPanel, {
    data, notify: () => {}, canManage: false,
  }));
  assert.match(html, /data-wfm-payroll-handoff/);
  assert.match(html, /No payroll-run link is available/);
  assert.doesNotMatch(html, /data-wfm-payroll-run-link|Open payroll run #42/);
  assert.match(html, /Source not verified/);
  assert.doesNotMatch(html, /No employees in your WFM scope/);
  const restricted = renderToStaticMarkup(createElement(WorkforceTimesheetPanel, {
    data: { ...data, access: { role: "manager", companyWide: false } },
    notify: () => {}, canManage: false,
  }));
  assert.doesNotMatch(restricted, /data-wfm-payroll-handoff|payroll-run-link/);
});

test("handoff reuses secured dashboard, abortable scoped WFM read and existing payroll focus gate", () => {
  const ui = readFileSync("src/components/workspace/workforce-timesheet-panel.tsx", "utf8");
  const selector = readFileSync("src/lib/workforce-payroll-handoff.ts", "utf8");
  const dashboard = readFileSync("src/lib/dashboard-data.ts", "utf8");
  const api = readFileSync("src/app/api/workforce/timesheets/route.ts", "utf8");
  const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");
  assert.match(ui, /verifiedWorkforceTimesheetCounts\(payload, \{ periodStart, periodEnd \}\)/);
  assert.match(ui, /timesheetResponse: trustedPayload/);
  assert.match(ui, /connectedNavigationEnabled: data\.firstPayrollConnectedEnabled === true/);
  assert.match(ui, /firstPayrollRunHref\(organizationId, run\.id\)/);
  assert.match(ui, /Source not verified/);
  assert.match(ui, /trustedPayload\?\.employees/);
  assert.match(dashboard, /eq\(payrollRuns\.organizationId, selectedOrganization\.id\)/);
  assert.match(api, /const access = await getAccess\(user\.id, organizationId\)/);
  assert.match(planner, /props\.data\.user\?\.id/);
  assert.doesNotMatch(selector, /fetch\(|\.post\(|INSERT INTO|UPDATE payroll|payout/);
});
