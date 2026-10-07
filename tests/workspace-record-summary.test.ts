import assert from "node:assert/strict";
import test from "node:test";
import { summarizePeopleRecords, summarizeCloseEvidence } from "../src/components/workspace/record-summary";
import { dashboardFixture, sampleRun } from "./fixtures/dashboard-ui";

test("people checks count active employees once and ignore unrelated inactive records", () => {
  const data = { ...dashboardFixture, employees: dashboardFixture.employees.slice(0, 2).map((e, i) => ({ ...e, status: i ? "Inactive" : "Active", bankAccount: null })) };
  data.punches = [{ id: 1, employeeId: data.employees[1].id, workDate: "2026-10-01", status: "incomplete", timeIn: null, timeOut: null }];
  const result = summarizePeopleRecords(data);
  assert.equal(result.active.length, 1);
  assert.equal(result.attention.length, 1);
  assert.equal(result.attendance.length, 0);
});

test("a bank file is export evidence, not payout or reconciliation evidence", () => {
  const event = { id: 1, actor: "Tester", action: "bank export generated", resource: "Payroll", metadata: { runId: sampleRun.id }, createdAt: "2026-10-01" };
  const result = summarizeCloseEvidence([event], sampleRun.id);
  assert.equal(result.bankExport, true);
  assert.equal(result.paid, false);
  assert.equal(result.closed, false);
  assert.equal(summarizeCloseEvidence([event], sampleRun.id + 1).bankExport, false);
});
