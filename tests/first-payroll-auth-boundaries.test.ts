import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_PAYROLL_STEPS } from "../src/lib/first-payroll-journey";

test("first-payroll ownership uses one canonical ordered set of seven roles", () => {
  const keys = FIRST_PAYROLL_STEPS.map(row => row.key);
  assert.deepEqual(keys, ["company", "people", "time", "reviewers", "payroll", "approval", "exports"]);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(FIRST_PAYROLL_STEPS.find(s => s.key === "time")?.allowedOwners, ["hr"]);
  assert.deepEqual(FIRST_PAYROLL_STEPS.find(s => s.key === "approval")?.allowedOwners, ["checker"]);
});

test("progress policy rejects irrelevant roles and cross-step assignments", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { canReadFirstPayrollProgress, canOwnJourneyStep, isJourneyKey } =
    await import("../src/lib/first-payroll-progress");
  for (const role of ["owner", "admin", "hr", "payroll", "checker", "bookkeeper"]) {
    assert.equal(canReadFirstPayrollProgress(role), true, role);
  }
  for (const role of ["manager", "employee", "", "viewer"]) {
    assert.equal(canReadFirstPayrollProgress(role), false, role);
  }
  assert.equal(canOwnJourneyStep("time", "hr"), true);
  assert.equal(canOwnJourneyStep("time", "owner"), false);
  assert.equal(canOwnJourneyStep("approval", "payroll"), false);
  assert.equal(canOwnJourneyStep("approval", "checker"), true);
  assert.equal(isJourneyKey("payroll"), true);
  assert.equal(isJourneyKey("injected"), false);
});
