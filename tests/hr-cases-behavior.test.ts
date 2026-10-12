import assert from "node:assert/strict";
import test from "node:test";
import { approvedCoeText, HR_CASE_TYPES, hrCaseDueAt, hrCaseSlaStatus, hrCaseTransitionAllowed, isHrCaseType } from "../src/lib/hr-case-policy";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("HR cases default to off, require exact true and do not confuse similar flags", () => {
  assert.equal(criticalReleaseFlagEnabled("employeeHrCases", {}), false);
  assert.equal(criticalReleaseFlagEnabled("employeeHrCases", { EMPLOYEE_HR_CASES_ENABLED: "TRUE" }), false);
  assert.equal(criticalReleaseFlagEnabled("employeeHrCases", { EMPLOYEE_HR_CASES_ENABLED: "true" }), true);
});

test("request categories route to a role with deterministic SLA boundaries", () => {
  for (const [kind, config] of Object.entries(HR_CASE_TYPES)) {
    assert.equal(isHrCaseType(kind), true);
    const start = new Date("2026-10-12T00:00:00Z");
    const due = hrCaseDueAt(kind as keyof typeof HR_CASE_TYPES, start);
    assert.equal(due.getTime() - start.getTime(), config.slaHours * 3_600_000);
    assert.equal(hrCaseSlaStatus(due, "open", new Date(due.getTime() + 1)).overdue, false);
    assert.equal(hrCaseSlaStatus(due, "open", new Date(due.getTime() + 3_600_001)).overdue, true);
    assert.equal(hrCaseSlaStatus(due, "resolved", new Date(due.getTime() + 3_600_001)).overdue, false);
  }
  assert.equal(isHrCaseType("government_id_scan"), false);
});

test("COE cannot be resolved without an independently approved document", () => {
  assert.equal(hrCaseTransitionAllowed("open", "resolved", "coe", false), false);
  assert.equal(hrCaseTransitionAllowed("open", "resolved", "coe", true), true);
  assert.equal(hrCaseTransitionAllowed("resolved", "closed", "coe", false), false);
  assert.equal(hrCaseTransitionAllowed("resolved", "closed", "coe", true), true);
  assert.equal(hrCaseTransitionAllowed("closed", "in_progress", "general", true), false);
  assert.equal(hrCaseTransitionAllowed("open", "closed", "general", true), false);
});

test("approved COE template renders factual employment data and rejects line-break injection", () => {
  const data = {
    employerName: "Example Corporation",
    employeeName: "Maria Santos",
    employeeTitle: "Analyst",
    startDate: "2025-01-01",
    approvedBy: "HR Approver",
    approvedDate: "2026-10-12",
  };
  const text = approvedCoeText(data);
  assert.match(text, /Maria Santos has been employed by Example Corporation/);
  assert.match(text, /Reviewed and approved by: HR Approver/);
  assert.doesNotMatch(text, /salary/i);
  assert.throws(() => approvedCoeText({ ...data, approvedBy: "Approver\nFake Signature" }));
});
