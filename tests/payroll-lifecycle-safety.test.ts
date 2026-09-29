import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel, payrollHandoffRank } from "../src/lib/payroll-handoff";
import {
  buildHandoffNotifications,
  buildRoleHandoffAction,
  selectHandoffRunForRole,
} from "../src/lib/payroll-handoff-actions";
import type { DashboardData, PayrollRun, Task } from "../src/components/workspace/types";

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


function makeRun(id: number, status: string, overrides: Partial<PayrollRun> = {}): PayrollRun {
  return {
    id,
    periodLabel: `Run ${id}`,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-15",
    scopeLabel: "All locations",
    scopeOrgUnitId: null,
    status,
    payDate: "2026-09-20",
    employeeCount: 1,
    grossPay: "10000.00",
    netPay: "9000.00",
    exceptions: 0,
    ruleVersion: "PH-2026.01",
    processedChunks: 1,
    totalChunks: 1,
    ...overrides,
  };
}

function makeTask(runId: number, status: string): Task {
  return {
    id: runId * 10,
    title: `Review Run ${runId}`,
    detail: `Payroll run #${runId} · review`,
    approver: "Mariel Santos",
    dueLabel: "Required before release",
    priority: "Normal",
    status,
  };
}

function handoffData(input: {
  runs?: PayrollRun[];
  tasks?: Task[];
  incompletePunch?: boolean;
  pendingLeave?: boolean;
  missingTin?: boolean;
  exception?: boolean;
} = {}): DashboardData {
  const employee = {
    id: 1,
    employeeNo: "EMP-001",
    firstName: "Jonas",
    lastName: "Reyes",
    title: "Support",
    employmentType: "Regular",
    status: "Active",
    avatarInitials: "JR",
    basicRate: "30000.00",
    mwe: false,
    email: "jonas@example.com",
    tin: input.missingTin ? null : "123-456-789-000",
    sssNo: "12-3456789-0",
    philHealthNo: "12-345678901-2",
    pagIbigNo: "1234-5678-9012",
  };

  return {
    user: { id: 1, email: "user@example.com", name: "Test User", role: "owner", totpEnabled: false },
    access: { companyWide: true, orgUnitName: null, role: "owner" },
    organizations: [{ id: 1, name: "Test Co", legalName: "Test Co Inc.", accountType: "company", plan: "Scale", employeeCount: 1, color: "#000" }],
    selectedOrganization: { id: 1, name: "Test Co", legalName: "Test Co Inc.", accountType: "company", plan: "Scale", employeeCount: 1, color: "#000" },
    employees: [employee],
    payrollRuns: input.runs ?? [makeRun(1, "Draft")],
    payrollHandoffRun: null,
    payrollEntries: input.exception
      ? [{ id: 1, employeeId: 1, grossPay: "10000.00", deductions: "1000.00", netPay: "9000.00", status: "Exception", trace: {} }]
      : [],
    payrollJobs: [],
    tasks: input.tasks ?? [],
    auditEvents: [],
    plans: [],
    templates: [],
    advisories: [],
    punches: input.incompletePunch
      ? [{ id: 1, employeeId: 1, workDate: "2026-09-10", status: "Late", timeIn: new Date("2026-09-10T01:00:00Z"), timeOut: null }]
      : [],
    delegations: [],
    leaveRequests: input.pendingLeave
      ? [{ id: 1, employeeId: 1, leaveType: "Vacation", startDate: "2026-09-12", endDate: "2026-09-12", days: "1", status: "Pending" }]
      : [],
    leavePolicies: [],
    orgUnits: [],
    capabilities: { orgStructure: true, payroll: true, approvals: true, multiBranch: false, developer: false },
    provisioning: [],
    payRevisions: [],
    retroAdjustments: [],
    freelancer: null,
  } as DashboardData;
}

test("handoff run selection prioritizes the run each role actually owns", () => {
  const work = makeRun(3, "Needs review", { exceptions: 2 });
  const checker = makeRun(2, "Pending approval");
  const release = makeRun(1, "Ready for release");
  const data = handoffData({ runs: [work, checker, release], tasks: [makeTask(2, "Pending"), makeTask(1, "Approved")] });

  assert.equal(selectHandoffRunForRole(data, "payroll")?.id, 3);
  assert.equal(selectHandoffRunForRole(data, "checker")?.id, 2);
  assert.equal(selectHandoffRunForRole(data, "owner")?.id, 1);
});

test("handoff notifications appear only for the role that owns the next action", () => {
  const draft = handoffData({ runs: [makeRun(1, "Draft")] });
  assert.equal(buildHandoffNotifications(draft, "hr").length, 0);
  assert.match(buildHandoffNotifications(draft, "payroll")[0]?.title ?? "", /prepare payroll/i);
  assert.equal(buildHandoffNotifications(draft, "checker").length, 0);
  assert.equal(buildHandoffNotifications(draft, "owner").length, 0);

  const needsReview = handoffData({ runs: [makeRun(2, "Needs review", { exceptions: 1 })], exception: true });
  assert.match(buildHandoffNotifications(needsReview, "payroll")[0]?.title ?? "", /resolve 1 payroll exception/i);
  assert.equal(buildHandoffNotifications(needsReview, "checker").length, 0);

  const pending = handoffData({ runs: [makeRun(3, "Pending approval")], tasks: [makeTask(3, "Pending")] });
  assert.equal(buildHandoffNotifications(pending, "payroll").length, 0);
  assert.match(buildHandoffNotifications(pending, "checker")[0]?.title ?? "", /ready for independent review/i);
  assert.equal(buildHandoffNotifications(pending, "owner").length, 0);

  const ready = handoffData({ runs: [makeRun(4, "Ready for release")], tasks: [makeTask(4, "Approved")] });
  assert.equal(buildHandoffNotifications(ready, "checker").length, 0);
  assert.match(buildHandoffNotifications(ready, "owner")[0]?.title ?? "", /ready to release/i);

  const released = handoffData({ runs: [makeRun(5, "Released")], tasks: [makeTask(5, "Approved")] });
  assert.equal(buildHandoffNotifications(released, "owner").length, 0);
});

test("HR blocker notifications disappear as their source records are resolved", () => {
  const blocked = handoffData({
    runs: [makeRun(1, "Draft")],
    incompletePunch: true,
    pendingLeave: true,
    missingTin: true,
  });
  const notifications = buildHandoffNotifications(blocked, "hr");
  assert.equal(notifications.length, 3);
  assert.deepEqual(new Set(notifications.map((item) => item.page)), new Set(["Time & attendance", "Leave", "People"]));
  assert.equal(notifications.find((item) => item.page === "People")?.employeeId, 1);

  const cleared = handoffData({ runs: [makeRun(1, "Draft")] });
  assert.equal(buildHandoffNotifications(cleared, "hr").length, 0);
  assert.equal(buildRoleHandoffAction(cleared, "hr").state, "complete");
  assert.match(buildRoleHandoffAction(cleared, "payroll").title, /prepare payroll/i);
});

test("completed late or overtime punches are not treated as missing-punch blockers", () => {
  const data = handoffData();
  data.punches = [{
    id: 8,
    employeeId: 1,
    workDate: "2026-09-10",
    status: "Late",
    timeIn: new Date("2026-09-10T01:15:00Z"),
    timeOut: new Date("2026-09-10T10:00:00Z"),
  }];
  assert.equal(buildHandoffNotifications(data, "hr").length, 0);
});

test("attendance corrections are audited and locked after payroll release", () => {
  const route = read("src/app/api/web-bundy/route.ts");
  const view = read("src/components/workspace/time.tsx");

  assert.ok(route.includes("export async function PATCH"));
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes('eq(payrollRuns.status, "Released")'));
  assert.ok(route.includes("Attendance inside a released payroll period is immutable"));
  assert.ok(route.includes('action: "Attendance punch corrected"'));
  assert.ok(route.includes("reason.length < 10"));

  assert.ok(view.includes('method: "PATCH"'));
  assert.ok(view.includes("Complete the missing punch pair"));
  assert.ok(view.includes("await onRefresh?.()"));
  assert.ok(view.includes("Save correction"));
});

test("generic advisories and lifecycle tasks no longer create bell noise", () => {
  const shell = read("src/components/workspace/shell.tsx");
  assert.ok(shell.includes("buildHandoffNotifications(data, role)"));
  assert.ok(!shell.includes("Active advisory "));
  assert.ok(!shell.includes("lifecycle checklist items open"));
});

test("in-flight and failure states remain owned by the correct handoff stage", () => {
  for (const status of ["Queued", "Processing", "Recalculating", "Failed"]) {
    assert.equal(payrollHandoffRank(status), 1, `${status} should stay with Payroll`);
  }
  assert.equal(payrollHandoffRank("Releasing"), 3, "Releasing should stay with Owner");
});


test("operational admin roles keep relevant handoff notifications", () => {
  const payroll = handoffData({ runs: [makeRun(10, "Needs review")] });
  assert.match(buildHandoffNotifications(payroll, "bookkeeper")[0]?.title ?? "", /ready for Checker|prepare payroll/i);

  const checker = handoffData({ runs: [makeRun(11, "Pending approval")], tasks: [makeTask(11, "Pending")] });
  assert.match(buildHandoffNotifications(checker, "manager")[0]?.title ?? "", /ready for independent review/i);

  const release = handoffData({ runs: [makeRun(12, "Ready for release")], tasks: [makeTask(12, "Approved")] });
  assert.match(buildHandoffNotifications(release, "admin")[0]?.title ?? "", /ready to release/i);
});
