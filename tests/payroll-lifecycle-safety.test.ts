import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel } from "../src/lib/payroll-handoff";
import { derivePayrollPostReleaseStatus } from "../src/lib/payroll-post-release";

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


test("release completion and payroll failure states are explicit and recoverable", () => {
  const releaseRoute = read("src/app/api/payroll-runs/[id]/release/route.ts");
  const payrollView = read("src/components/workspace/payroll-run.tsx");
  const exportsView = read("src/components/workspace/exports.tsx");

  for (const marker of [
    "Payroll release receipt",
    "Ready to generate from the released register",
    "releasedAt",
    "missingEmail",
    "warningCount",
  ]) {
    assert.ok(releaseRoute.includes(marker), `release receipt is missing ${marker}`);
  }

  for (const marker of [
    "data-release-receipt",
    "Calculation failed",
    "Retry calculation",
    "Unresolved payroll exceptions",
    "Review exceptions",
    "Checker declined this payroll",
    "Resubmit to checker",
    "Release blocked",
    "Review release checks",
    'data-recovery-state="export-failed"',
    "Retry export",
  ]) {
    assert.ok(payrollView.includes(marker), `payroll recovery UX is missing ${marker}`);
  }

  assert.ok(exportsView.includes('data-recovery-state="export-failed"'));
  assert.ok(exportsView.includes("Retry export"));
  assert.ok(!exportsView.includes('window.open(url, "_blank", "noopener")'), "export failures must be observable before download");
});


test("post-release payout trail is exact-run, durable and does not overstate settlement", () => {
  const run = { id: 77, status: "Released" };
  const base = [
    {
      action: "Payroll release receipt",
      metadata: { runId: 77 },
      createdAt: "2026-09-30T01:00:00.000Z",
    },
  ];

  assert.equal(derivePayrollPostReleaseStatus(run, base)?.state, "released");

  const exported = derivePayrollPostReleaseStatus(run, [
    ...base,
    {
      action: "bank export generated",
      metadata: { runId: 77, filename: "bdo-77.dat" },
      createdAt: "2026-09-30T01:05:00.000Z",
    },
    {
      action: "bank export generated",
      metadata: { runId: 88, filename: "wrong-run.dat" },
      createdAt: "2026-09-30T01:06:00.000Z",
    },
  ]);
  assert.equal(exported?.state, "exported");
  assert.equal(exported?.bankFilename, "bdo-77.dat");

  const submitted = derivePayrollPostReleaseStatus(run, [
    ...base,
    {
      action: "bank export generated",
      metadata: { runId: 77, filename: "bdo-77.dat" },
      createdAt: "2026-09-30T01:05:00.000Z",
    },
    {
      action: "Payroll bank upload confirmed",
      metadata: { runId: 77, settlementVerified: false },
      createdAt: "2026-09-30T01:10:00.000Z",
    },
  ]);
  assert.equal(submitted?.state, "submitted");
  assert.match(submitted?.detail ?? "", /not final bank settlement/i);

  const disbursed = derivePayrollPostReleaseStatus(run, [
    ...base,
    {
      action: "Payroll disbursed via PayMongo",
      metadata: { runId: 77, batchId: "batch_1" },
      createdAt: "2026-09-30T01:15:00.000Z",
    },
  ]);
  assert.equal(disbursed?.state, "disbursed");

  const confirmation = read("src/app/api/payroll-runs/[id]/payout-confirmation/route.ts");
  const exportsRoute = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  assert.ok(confirmation.includes("PAYROLL_DISBURSEMENT_ROLES"));
  assert.ok(confirmation.includes("Generate the final bank file for this exact payroll run"));
  assert.ok(confirmation.includes("settlementVerified: false"));
  assert.ok(exportsRoute.includes("runId: run.id"));
});
