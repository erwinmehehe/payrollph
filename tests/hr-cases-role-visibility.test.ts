import assert from "node:assert/strict";
import test from "node:test";
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
      assert.equal(hrCaseRoleCanWork(forbidden, assignee), false, \`\${forbidden} must not read \${kind}\`);
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
