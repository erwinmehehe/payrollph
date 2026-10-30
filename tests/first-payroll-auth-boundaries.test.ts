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

test("payroll source figures remain behind the existing payroll-view authorization", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const {roleAllowed, PAYROLL_VIEW_ROLES} = await import("../src/lib/access");
  const {readFileSync} = await import("node:fs");
  const route = readFileSync("src/app/api/first-payroll/preview/route.ts", "utf8");
  const panel = readFileSync("src/components/workspace/first-payroll-inline-panel.tsx", "utf8");
  assert.match(route, /assertOrganizationRole\(user\.id,organizationId,PAYROLL_VIEW_ROLES/);
  assert.match(route, /if\(denied\)return privatePreviewDenied\(denied\)/);
  assert.match(route, /if\(!access\?\.companyWide\)/);
  assert.match(route, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
  for (const role of ["employee", "manager", "hr", "viewer", "group_hr", ""]) {
    assert.equal(roleAllowed(role,PAYROLL_VIEW_ROLES), false, role + " cannot access figures");
  }
  for (const role of ["owner", "admin", "bookkeeper", "payroll", "checker"]) {
    assert.equal(roleAllowed(role,PAYROLL_VIEW_ROLES), true, role + " retains its existing read access");
  }
  assert.match(panel, /preview&&canPreviewPayroll&&/);
  assert.doesNotMatch(panel, /send\("\/api\/payroll-runs","POST"/,
    "preview component must not create or enqueue any payroll run");
});
