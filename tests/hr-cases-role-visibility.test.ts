import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  HR_CASE_TYPES, hrCaseRoleCanWork, visibleHrCaseMessages,
  hrCaseTransitionAllowed, hrCaseDueAt, hrCaseSlaStatus,
} from "../src/lib/hr-case-policy";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("HR queue is default-off and only an exact server env true can enable it", () => {
  assert.equal(criticalReleaseFlagEnabled("employeeHrCases", {}), false);
  assert.equal(criticalReleaseFlagEnabled("employeeHrCases", { EMPLOYEE_HR_CASES_ENABLED: "True" }), false);
  assert.equal(criticalReleaseFlagEnabled("employeeHrCases", { EMPLOYEE_HR_CASES_ENABLED: "true" }), true);
});

test("assigned HR cases and payroll cases are mutually confidential", () => {
  for (const kind of Object.keys(HR_CASE_TYPES) as Array<keyof typeof HR_CASE_TYPES>) {
    const assignee = HR_CASE_TYPES[kind].assignedRole;
    assert.equal(hrCaseRoleCanWork("owner", assignee), true);
    assert.equal(hrCaseRoleCanWork("admin", assignee), true);
    assert.equal(hrCaseRoleCanWork("hr", assignee), assignee === "hr");
    assert.equal(hrCaseRoleCanWork("payroll", assignee), assignee === "payroll");
    for (const forbidden of ["employee", "manager", "bookkeeper", "checker", "viewer", ""]) {
      assert.equal(hrCaseRoleCanWork(forbidden, assignee), false, forbidden + " must not read " + kind);
    }
  }
  assert.equal(hrCaseRoleCanWork("owner", "unknown"), false);
});

test("internal notes cannot leak into employee timelines, including in mixed batches", () => {
  const messages = [
    { id: 1, caseId: 7, visibility: "employee", body: "Employee asked about a payslip." },
    { id: 2, caseId: 7, visibility: "internal", body: "Confidential investigation evidence." },
    { id: 3, caseId: 7, visibility: "employee", body: "HR has received the request." },
  ];
  assert.deepEqual(visibleHrCaseMessages(messages, "employee").map(x => x.id), [1, 3]);
  assert.deepEqual(visibleHrCaseMessages(messages, "staff").map(x => x.id), [1, 2, 3]);
  assert.equal(JSON.stringify(visibleHrCaseMessages(messages, "employee")).includes("investigation evidence"), false);
  assert.equal(messages.length, 3, "projection must not mutate the source");
});

test("an unapproved COE cannot be closed, even if its SLA has elapsed", () => {
  const startedAt = new Date("2026-10-12T01:00:00Z");
  const due = hrCaseDueAt("coe", startedAt);
  assert.equal(hrCaseSlaStatus(due, "open", new Date(due.getTime() + 7200000)).overdue, true);
  assert.equal(hrCaseTransitionAllowed("open", "resolved", "coe", false), false);
  assert.equal(hrCaseTransitionAllowed("resolved", "closed", "coe", false), false);
  assert.equal(hrCaseTransitionAllowed("resolved", "closed", "coe", true), true);
});


test("employee HR request panel visibly distinguishes API outages from disabled 404", () => {
  const source = readFileSync("src/components/employee-hr-cases-panel.tsx", "utf8");
  const reader = readFileSync("src/lib/employee-hr-cases-read.ts", "utf8");
  // Failed/unauthorized/malformed GETs stay visible instead of looking like disabled.
  assert.match(source, /setAvailable\(true\); \/\/ Auth\/server\/network errors/);
  assert.match(source, /setError\(cause instanceof Error \? cause.message/);
  assert.match(reader, /response.status === 404 && record\(payload\)/);
  assert.match(reader, /payload.error === "HR cases are not enabled for this release\."/);
  // A stale snapshot cannot keep request/reply actions available after a failed read.
  assert.match(source, /setCases\(null\)/);
  assert.match(source, /const canAct = cases !== null && !loading && !error && !busy/);
  assert.match(source, /Retry HR requests/);
  assert.match(source, /if \(loading && !available\) return <p role="status">/);
  assert.match(source, /if \(!available\) return null/);
});
