import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel } from "../src/lib/payroll-handoff";
import { buildRoleInbox } from "../src/lib/role-inbox";
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


test("role inbox assigns the next concrete action to the active handoff owner", () => {
  const data = {
    user: { id: 1, email: "payroll@example.com", name: "Payroll User", role: "payroll", totpEnabled: false },
    access: { companyWide: true, orgUnitName: null, role: "payroll" },
    organizations: [],
    selectedOrganization: { id: 1, name: "Loom & Local", legalName: "Loom & Local Inc.", plan: "Scale", accountType: "business", employeeCount: 2, color: "#176B5D" },
    employees: [],
    payrollRuns: [{
      id: 9,
      organizationId: 1,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-10-05",
      status: "Needs review",
      grossPay: "100000.00",
      netPay: "80000.00",
      exceptions: 0,
      employeeCount: 2,
      ruleVersion: "PH-2026.01",
      totalChunks: 1,
      processedChunks: 1,
    }],
    payrollEntries: [],
    tasks: [],
    auditEvents: [],
    plans: [],
    templates: [],
    advisories: [],
    freelancer: null,
  } as unknown as DashboardData;

  const payrollInbox = buildRoleInbox(data, "payroll");
  assert.equal(payrollInbox.currentStage, "payroll");
  assert.equal(payrollInbox.items[0]?.id, "payroll-submit");
  assert.equal(payrollInbox.items[0]?.page, "Payroll");

  data.payrollRuns[0].status = "Ready for release";
  const ownerInbox = buildRoleInbox(data, "owner");
  assert.equal(ownerInbox.currentStage, "owner");
  assert.equal(ownerInbox.items[0]?.id, "owner-release");

  const payrollWaiting = buildRoleInbox(data, "payroll");
  assert.equal(payrollWaiting.items.length, 0);
  assert.equal(payrollWaiting.currentOwner, "Owner");
});

test("formal payroll handoffs queue the next-person notification", () => {
  const submit = read("src/app/api/payroll-runs/[id]/submit-review/route.ts");
  const approvals = read("src/app/api/approvals/[id]/route.ts");
  const release = read("src/app/api/payroll-runs/[id]/release/route.ts");

  assert.ok(submit.includes('purpose: "payroll-review-required"'));
  assert.ok(submit.includes("recipient: checker.email"));

  assert.ok(approvals.includes('purpose: "payroll-ready-for-release"'));
  assert.ok(approvals.includes("PAYROLL_RELEASE_ROLES"));
  assert.ok(approvals.includes('purpose: "payroll-needs-rework"'));
  assert.ok(approvals.includes("makerUserId"));

  assert.ok(release.includes('purpose: "payslip-ready"'));
});
