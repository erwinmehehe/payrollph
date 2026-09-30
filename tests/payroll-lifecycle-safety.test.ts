import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel } from "../src/lib/payroll-handoff";
import { buildPayrollAttention } from "../src/lib/payroll-attention";
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
    ["Queued", "payroll"],
    ["Failed", "payroll"],
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


function attentionData(status: string): DashboardData {
  return {
    user: { id: 1, name: "Test User", email: "test@example.com", role: "owner", totpEnabled: false },
    organizations: [],
    selectedOrganization: {
      id: 1,
      name: "Test Co",
      legalName: "Test Co Inc.",
      plan: "Scale",
      accountType: "employer",
      employeeCount: 1,
      color: "#444CE7",
    },
    employees: [
      {
        id: 7,
        employeeNo: "EMP-007",
        firstName: "Ada",
        lastName: "Santos",
        title: "Analyst",
        employmentType: "Regular",
        status: "Active",
        avatarInitials: "AS",
        basicRate: "30000",
        mwe: false,
        tin: null,
        sssNo: null,
        philHealthNo: null,
        pagIbigNo: null,
      },
    ],
    payrollRuns: [
      {
        id: 41,
        periodLabel: "Sep 16–30, 2026",
        periodStart: "2026-09-16",
        periodEnd: "2026-09-30",
        scopeLabel: "All employees",
        status,
        payDate: "2026-10-05",
        employeeCount: 1,
        grossPay: "30000",
        netPay: "27000",
        exceptions: 0,
        ruleVersion: "PH-2026.01",
      },
    ],
    payrollHandoffRun: null,
    payrollEntries: [],
    payrollJobs: [],
    tasks: [],
    auditEvents: [],
    plans: [],
    templates: [],
    advisories: [],
    punches: [],
    delegations: [],
    leaveRequests: [],
    leavePolicies: [],
    orgUnits: [],
    access: { companyWide: true, orgUnitName: null, role: "owner" },
    capabilities: { orgStructure: true, payroll: true, approvals: true, multiBranch: true, developer: false },
    provisioning: [],
    payRevisions: [],
    retroAdjustments: [],
    freelancer: null,
  } as DashboardData;
}

test("HR payroll attention points directly at unresolved cutoff inputs", () => {
  const data = attentionData("Draft");
  data.punches = [{ id: 1, employeeId: 7, workDate: "2026-09-30", status: "Incomplete", timeIn: new Date(), timeOut: null }];
  data.leaveRequests = [{ id: 2, employeeId: 7, leaveType: "Annual leave", startDate: "2026-09-29", endDate: "2026-09-29", days: "1", status: "Pending" }];

  const items = buildPayrollAttention(data, "hr");
  assert.deepEqual(items.map((item) => item.page), ["Time & attendance", "Leave", "People"]);
  assert.equal(items.find((item) => item.page === "People")?.employeeId, 7);
  assert.equal(items.find((item) => item.page === "Time & attendance")?.actionLabel, "Fix attendance");
});

test("payroll attention changes from exceptions to checker handoff when blockers clear", () => {
  const data = attentionData("Needs review");
  data.payrollEntries = [{ id: 1, employeeId: 7, grossPay: "30000", deductions: "3000", netPay: "27000", status: "Exception", trace: {} }];

  const blocked = buildPayrollAttention(data, "payroll");
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].title, /payroll exception/i);
  assert.equal(blocked[0].actionLabel, "Review exceptions");

  data.payrollEntries = [];
  const ready = buildPayrollAttention(data, "payroll");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].actionLabel, "Submit for review");
});

test("checker and owner notifications exist only while they own the handoff", () => {
  const data = attentionData("Pending approval");
  data.tasks = [{
    id: 9,
    title: "Review payroll",
    detail: "Payroll run #41 · Sep 16–30, 2026",
    approver: "Mariel Santos",
    dueLabel: "Today",
    priority: "High",
    status: "Pending",
  }];

  const checker = buildPayrollAttention(data, "checker");
  assert.equal(checker.length, 1);
  assert.equal(checker[0].actionLabel, "Review payroll");
  assert.equal(buildPayrollAttention(data, "owner").length, 0);

  data.payrollRuns[0].status = "Ready for release";
  data.tasks[0].status = "Approved";
  assert.equal(buildPayrollAttention(data, "checker").length, 0);
  const owner = buildPayrollAttention(data, "owner");
  assert.equal(owner.length, 1);
  assert.equal(owner[0].actionLabel, "Release payroll");
  assert.equal(owner[0].runId, 41);

  data.payrollRuns[0].status = "Released";
  assert.equal(buildPayrollAttention(data, "owner").length, 0);
});

test("generic provisioning and advisory rows do not create payroll handoff noise", () => {
  const data = attentionData("Released");
  data.provisioning = [{ id: 3, employeeId: 7, kind: "onboarding", title: "Issue laptop", owner: "HR", done: false }];
  data.advisories = [{ id: 4, advisoryNumber: "ADV-1", policy: "Calamity", startDate: "2026-09-01", endDate: "2026-09-30", affectedUnit: "All", active: true }];

  for (const role of ["owner", "hr", "payroll", "checker"]) {
    assert.deepEqual(buildPayrollAttention(data, role), []);
  }
});


test("role attention does not lose an older checker handoff when a newer payroll is already in progress", () => {
  const data = attentionData("Needs review");
  data.payrollRuns = [
    {
      ...data.payrollRuns[0],
      id: 42,
      periodLabel: "Sep 16–30, 2026",
      status: "Needs review",
    },
    {
      ...data.payrollRuns[0],
      id: 41,
      periodLabel: "Sep 1–15, 2026",
      status: "Pending approval",
      payDate: "2026-09-18",
    },
  ];
  data.tasks = [{
    id: 12,
    title: "Review payroll",
    detail: "Payroll run #41 · Sep 1–15, 2026",
    approver: "Mariel Santos",
    dueLabel: "Today",
    priority: "High",
    status: "Pending",
  }];

  const payroll = buildPayrollAttention(data, "payroll");
  assert.equal(payroll.length, 1);
  assert.match(payroll[0].detail, /Sep 16–30, 2026/);

  const checker = buildPayrollAttention(data, "checker");
  assert.equal(checker.length, 1);
  assert.match(checker[0].detail, /Sep 1–15, 2026/);
  assert.equal(checker[0].actionLabel, "Review payroll");
});


test("complete attendance does not become a blocker just because its label is late or undertime", () => {
  const data = attentionData("Draft");
  data.employees[0].tin = "123-456-789";
  data.employees[0].sssNo = "34-1234567-8";
  data.employees[0].philHealthNo = "12-345678901-2";
  data.employees[0].pagIbigNo = "1234-5678-9012";
  data.punches = [{
    id: 5,
    employeeId: 7,
    workDate: "2026-09-30",
    status: "Late",
    timeIn: new Date("2026-09-30T08:17:00+08:00"),
    timeOut: new Date("2026-09-30T17:00:00+08:00"),
  }];

  assert.deepEqual(buildPayrollAttention(data, "hr"), []);
});


test("payroll attention waits during calculation and surfaces real failed worker jobs", () => {
  const data = attentionData("Queued");
  data.payrollJobs = [{ id: 1, status: "queued", chunkIndex: 0 }];
  assert.deepEqual(buildPayrollAttention(data, "payroll"), [], "queued work should not create a user-action notification");

  data.payrollRuns[0].status = "Failed";
  data.payrollJobs = [{ id: 1, status: "failed", chunkIndex: 0 }];
  const failed = buildPayrollAttention(data, "payroll");
  assert.equal(failed.length, 1);
  assert.match(failed[0].title, /failed/i);
  assert.equal(failed[0].actionLabel, "Open payroll");
});
