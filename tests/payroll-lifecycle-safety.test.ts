import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel } from "../src/lib/payroll-handoff";
import { getPayrollActions } from "../src/lib/payroll-action-center";
import type { DashboardData } from "../src/components/workspace/types";

const read = (path: string) => readFileSync(path, "utf8");

test("regular payroll scopes only active employees at draft and calculation time", () => {
  const createRun = read("src/app/api/payroll-runs/route.ts");
  const engine = read("src/lib/payroll-engine.ts");

  assert.ok(createRun.includes('eq(employees.status, "Active")'));
  assert.ok(createRun.includes("has no active employees"));
  assert.ok((engine.match(/eq\(employees\.status, "Active"\)/g) ?? []).length >= 2);
  assert.ok(engine.includes("Payroll scope has no active employees"));
  assert.ok(engine.includes("Payroll employee scope changed after calculation was queued"));
});

test("calculation snapshots payout instructions and release rejects stale employee data", () => {
  const engine = read("src/lib/payroll-engine.ts");
  const settlement = read("src/lib/payroll-settlement.ts");

  assert.ok(engine.includes("payment: {"));
  assert.ok(engine.includes("payProfile: {"));
  assert.ok(engine.includes("bankAccount: employee.bankAccount"));
  assert.ok(engine.includes("mobile: employee.mobile"));
  assert.ok(settlement.includes("lacks an immutable payment snapshot"));
  assert.ok(settlement.includes('employee.status !== "Active"'));
  assert.ok(settlement.includes("Payment instructions for"));
  assert.ok(settlement.includes("lacks an immutable pay-profile snapshot"));
  assert.ok(settlement.includes("Pay profile for"));
  assert.ok(settlement.includes("changed after calculation"));
  assert.ok(settlement.includes("no captured bank account or mobile payout destination"));
});

test("final bank files and payslips are release-only", () => {
  const route = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  const exporter = read("src/lib/exporters.ts");

  assert.ok(route.includes('kind === "bank" && !dryRun && run.status !== "Released"'));
  assert.ok(route.includes('kind === "payslip" && run.status !== "Released"'));
  assert.ok(route.includes('kind === "journal" && run.status !== "Released"'));
  assert.ok(exporter.includes('run.status !== "Released"'));
  assert.ok(exporter.includes("missingPaymentSnapshots"));
  assert.ok(exporter.includes("Final bank file total does not match the released payroll net pay"));
});

test("pre-release UI can validate payout but cannot create a final bank file", () => {
  const view = read("src/components/workspace/payroll-run.tsx");

  assert.ok(view.includes('title="Validate / Export"'));
  assert.ok(view.includes("Dry run only until payroll is released"));
  assert.ok(view.includes("disabled={!released}"));
  assert.ok(view.includes("Payslip download unlocks after payroll release"));
});

test("recalculation invalidates linked approvals and replaces derived register data", () => {
  const process = read("src/app/api/payroll-runs/[id]/process/route.ts");
  const engine = read("src/lib/payroll-engine.ts");
  const schema = read("src/db/schema.ts");

  assert.ok(process.includes('status: "Superseded"'));
  assert.ok(process.includes('eq(payrollRuns.status, run.status)'));
  assert.ok(engine.includes("db.delete(payrollEntries)"));
  assert.ok(engine.includes("db.delete(payrollJobs)"));
  assert.ok(schema.includes('references(() => payrollEntries.id, { onDelete: "cascade" })'));
});


test("payroll handoff maps lifecycle states to the next responsible role", () => {
  const cases = [
    ["Draft", "hr"],
    ["Needs review", "payroll"],
    ["Pending approval", "checker"],
    ["Ready for release", "owner"],
    ["Released", "employee"],
  ] as const;

  for (const [status, expected] of cases) {
    const stages = buildPayrollHandoff({
      status,
      periodLabel: "Sep 16–30, 2026",
      payDate: "2026-10-05",
    });
    assert.equal(stages.find((stage) => stage.state === "current")?.key, expected, `${status} should hand off to ${expected}`);
  }
});

test("employee-facing payroll labels never imply unreleased pay is available", () => {
  assert.equal(employeePayStatusLabel("Draft"), "Inputs are being prepared");
  assert.equal(employeePayStatusLabel("Needs review"), "Payroll is being finalized");
  assert.equal(employeePayStatusLabel("Pending approval"), "With an independent checker");
  assert.equal(employeePayStatusLabel("Ready for release"), "Approved, waiting for release");
  assert.equal(employeePayStatusLabel("Released"), "Payslip available");
});


function actionData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    user: { id: 1, email: "user@example.com", name: "Test User", role: "owner", totpEnabled: false },
    organizations: [],
    selectedOrganization: {
      id: 1,
      name: "Test Co",
      legalName: "Test Co Inc.",
      accountType: "company",
      plan: "Scale",
      employeeCount: 0,
      color: "#000000",
    },
    employees: [],
    payrollRuns: [],
    payrollEntries: [],
    tasks: [],
    auditEvents: [],
    plans: [],
    templates: [],
    advisories: [],
    punches: [],
    leaveRequests: [],
    provisioning: [],
    freelancer: null,
    ...overrides,
  };
}

test("HR action center exposes only unresolved cutoff inputs", () => {
  const data = actionData({
    employees: [{
      id: 10,
      employeeNo: "E-10",
      firstName: "Ana",
      lastName: "Reyes",
      title: "Coordinator",
      employmentType: "Regular",
      status: "Active",
      avatarInitials: "AR",
      basicRate: "30000",
      mwe: false,
      tin: null,
      sssNo: null,
      philHealthNo: null,
      pagIbigNo: null,
    }],
    leaveRequests: [{
      id: 1,
      employeeId: 10,
      leaveType: "Annual leave",
      startDate: "2026-09-29",
      endDate: "2026-09-29",
      days: "1",
      status: "Pending",
    }],
    punches: [{
      id: 1,
      employeeId: 10,
      workDate: "2026-09-29",
      status: "Incomplete",
      timeIn: new Date("2026-09-29T01:00:00Z"),
      timeOut: null,
    }],
  });

  assert.deepEqual(
    getPayrollActions(data, "hr").map((item) => item.id),
    ["hr-leave", "hr-attendance", "hr-government-ids"],
  );

  const resolved = actionData({
    employees: data.employees.map((employee) => ({
      ...employee,
      tin: "123",
      sssNo: "123",
      philHealthNo: "123",
      pagIbigNo: "123",
    })),
    leaveRequests: data.leaveRequests?.map((request) => ({ ...request, status: "Approved" })),
    punches: data.punches?.map((punch) => ({ ...punch, status: "Complete", timeOut: new Date("2026-09-29T09:00:00Z") })),
  });
  assert.deepEqual(getPayrollActions(resolved, "hr"), []);
});

test("Payroll action center moves from exceptions to checker handoff and then clears", () => {
  const run = {
    id: 9,
    periodLabel: "Sep 16-30",
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
    scopeLabel: "All employees",
    status: "Needs review",
    payDate: "2026-10-05",
    employeeCount: 10,
    grossPay: "100000",
    netPay: "80000",
    exceptions: 2,
    ruleVersion: "PH-2026.01",
  };

  const withExceptions = actionData({ payrollRuns: [run] });
  assert.equal(getPayrollActions(withExceptions, "payroll")[0]?.id, "payroll-exceptions-9");

  const clean = actionData({ payrollRuns: [{ ...run, exceptions: 0 }] });
  assert.equal(getPayrollActions(clean, "payroll")[0]?.id, "payroll-submit-9");

  const submitted = actionData({ payrollRuns: [{ ...run, exceptions: 0, status: "Pending approval" }] });
  assert.deepEqual(getPayrollActions(submitted, "payroll"), []);
});

test("Checker and Owner attention follows the maker-checker transition", () => {
  const run = {
    id: 12,
    periodLabel: "Sep 16-30",
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
    scopeLabel: "All employees",
    status: "Pending approval",
    payDate: "2026-10-05",
    employeeCount: 10,
    grossPay: "100000",
    netPay: "80000",
    exceptions: 0,
    ruleVersion: "PH-2026.01",
  };
  const pendingTask = {
    id: 77,
    title: "Payroll review",
    detail: "Payroll run #12",
    approver: "Checker",
    dueLabel: "Today",
    priority: "High",
    status: "Pending",
  };

  const pending = actionData({ payrollRuns: [run], tasks: [pendingTask] });
  assert.equal(getPayrollActions(pending, "checker")[0]?.id, "checker-review-77");
  assert.deepEqual(getPayrollActions(pending, "owner"), []);

  const approved = actionData({
    payrollRuns: [{ ...run, status: "Ready for release" }],
    tasks: [{ ...pendingTask, status: "Approved" }],
  });
  assert.deepEqual(getPayrollActions(approved, "checker"), []);
  assert.equal(getPayrollActions(approved, "owner")[0]?.id, "owner-release-12");

  const released = actionData({
    payrollRuns: [{ ...run, status: "Released" }],
    tasks: [{ ...pendingTask, status: "Approved" }],
  });
  assert.deepEqual(getPayrollActions(released, "owner"), []);
});


test("HR can resolve an incomplete attendance blocker through an audited correction", () => {
  const route = read("src/app/api/web-bundy/route.ts");
  const timeView = read("src/components/workspace/time.tsx");
  const engine = read("src/lib/payroll-engine.ts");

  assert.ok(route.includes("export async function PATCH"));
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("Only People administrators can correct attendance records."));
  assert.ok(route.includes("This correction flow is only for incomplete punches."));
  assert.ok(route.includes('action: "Attendance punch corrected"'));
  assert.ok(route.includes('status: "Complete"'));

  assert.ok(timeView.includes("Fix punch"));
  assert.ok(timeView.includes('method: "PATCH"'));
  assert.ok(timeView.includes('fetch("/api/web-bundy"'));
  assert.ok(timeView.includes("Recalculate any payroll run that already used this work date"));

  assert.ok(engine.includes("timeIn: punch.timeIn"));
  assert.ok(engine.includes("timeOut: punch.timeOut"));
});
