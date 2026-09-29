import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel } from "../src/lib/payroll-handoff";
import { buildHandoffAttention } from "../src/lib/handoff-attention";
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


function attentionData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    user: { id: 1, email: "role@example.com", name: "Role User", role: "owner", totpEnabled: false },
    organizations: [],
    selectedOrganization: {
      id: 1,
      name: "Loom & Local",
      legalName: "Loom & Local Inc.",
      accountType: "business",
      plan: "Scale",
      employeeCount: 1,
      color: "#176B5D",
    },
    employees: [{
      id: 1,
      employeeNo: "E-001",
      firstName: "Jonas",
      lastName: "Reyes",
      title: "Designer",
      employmentType: "Regular",
      status: "Active",
      avatarInitials: "JR",
      basicRate: "30000",
      mwe: false,
      tin: "123",
      sssNo: "456",
      philHealthNo: "789",
      pagIbigNo: "101",
    }],
    payrollRuns: [{
      id: 10,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All employees",
      status: "Needs review",
      payDate: "2026-10-05",
      employeeCount: 1,
      grossPay: "30000",
      netPay: "25000",
      exceptions: 0,
      ruleVersion: "PH-2026.01",
    }],
    payrollEntries: [],
    tasks: [],
    auditEvents: [],
    plans: [],
    templates: [],
    advisories: [],
    punches: [],
    leaveRequests: [],
    freelancer: null,
    ...overrides,
  } as DashboardData;
}

test("HR and Payroll handoff alerts are derived from live blockers and clear when resolved", () => {
  const blocked = attentionData({
    employees: [{
      ...attentionData().employees[0],
      tin: null,
    }],
    punches: [{
      id: 1,
      employeeId: 1,
      workDate: "2026-09-29",
      status: "Incomplete",
      timeIn: new Date("2026-09-29T08:00:00+08:00"),
      timeOut: null,
    }],
    leaveRequests: [{
      id: 1,
      employeeId: 1,
      leaveType: "Vacation",
      startDate: "2026-09-30",
      endDate: "2026-09-30",
      days: "1",
      status: "Pending",
    }],
  });

  assert.deepEqual(
    buildHandoffAttention(blocked, "hr").map((item) => item.id),
    ["hr-attendance", "hr-leave", "hr-government-ids"],
  );
  assert.deepEqual(
    buildHandoffAttention(blocked, "payroll").map((item) => item.id),
    ["payroll-waiting-attendance", "payroll-waiting-leave", "payroll-waiting-ids"],
  );

  const clear = attentionData();
  assert.deepEqual(
    buildHandoffAttention(clear, "payroll").map((item) => item.id),
    ["payroll-submit-10"],
    "once HR blockers clear, Payroll gets the submit-to-checker action instead of stale blocker alerts",
  );
  assert.equal(buildHandoffAttention(clear, "payroll")[0]?.focus, "submit-review");
});

test("Checker and Owner notifications follow payroll state and disappear after the action completes", () => {
  const pendingTask = {
    id: 7,
    title: "Review Sep 16–30 payroll",
    detail: "Payroll run #10 · 0 review item(s)",
    approver: "Mariel Santos",
    dueLabel: "Required before release",
    priority: "Normal",
    status: "Pending",
  };

  const checker = attentionData({
    payrollRuns: [{ ...attentionData().payrollRuns[0], status: "Pending approval" }],
    tasks: [pendingTask],
  });
  assert.equal(buildHandoffAttention(checker, "checker")[0]?.actionLabel, "Review now");

  const checkerDone = attentionData({
    payrollRuns: [{ ...attentionData().payrollRuns[0], status: "Ready for release" }],
    tasks: [{ ...pendingTask, status: "Approved" }],
  });
  assert.equal(buildHandoffAttention(checkerDone, "checker").length, 0);

  const ownerReady = buildHandoffAttention(checkerDone, "owner");
  assert.equal(ownerReady[0]?.actionLabel, "Release payroll");
  assert.equal(ownerReady[0]?.focus, "release-payroll");

  const released = attentionData({
    payrollRuns: [{ ...attentionData().payrollRuns[0], status: "Released" }],
    tasks: [{ ...pendingTask, status: "Approved" }],
  });
  assert.equal(buildHandoffAttention(released, "owner").length, 0);
});

test("transition notifications are targeted at checker, owner and employees", () => {
  const submit = read("src/app/api/payroll-runs/[id]/submit-review/route.ts");
  const decide = read("src/app/api/approvals/[id]/route.ts");
  const release = read("src/app/api/payroll-runs/[id]/release/route.ts");

  assert.ok(submit.includes('purpose: "payroll-review-ready"'));
  assert.ok(submit.includes("Payroll ready for your review"));
  assert.ok(decide.includes('purpose: "payroll-release-ready"'));
  assert.ok(decide.includes("Payroll approved and ready to release"));
  assert.ok(release.includes('purpose: "payslip-ready"'));
  assert.ok(release.includes("Your payslip for"));
});

test("workspace notification tray uses the same handoff source and exposes direct actions", () => {
  const shell = read("src/components/workspace/shell.tsx");
  const workspace = read("src/components/linaw-workspace.tsx");
  assert.ok(shell.includes("buildHandoffAttention(data"));
  assert.ok(shell.includes("item.actionLabel"));
  assert.ok(workspace.includes("onNotificationAction={openAttention}"));
  assert.ok(workspace.includes('item.focus === "incomplete-attendance"'));
  assert.ok(workspace.includes('item.focus === "payroll-exceptions"'));
  assert.ok(workspace.includes('item.focus === "submit-review"'));
  assert.ok(workspace.includes('item.focus === "release-payroll"'));

  const payroll = read("src/components/workspace/payroll-run.tsx");
  assert.ok(payroll.includes("focusReviewToken"));
  assert.ok(payroll.includes("void openReviewSubmission()"));
  assert.ok(payroll.includes("focusReleaseToken"));
  assert.ok(payroll.includes("setConfirmRelease(true)"));
});
