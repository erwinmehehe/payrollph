import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel } from "../src/lib/payroll-handoff";
import { derivePayrollPayoutState } from "../src/lib/payroll-payout-state";

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


test("released payroll payout completion is audit-derived and ordered", () => {
  const now = new Date("2026-09-30T02:00:00Z");
  const events = [
    {
      id: 1,
      actor: "Owner",
      action: "Payroll release receipt",
      resource: "Sep 16–30, 2026",
      metadata: { runId: 77 },
      createdAt: now,
    },
    {
      id: 2,
      actor: "Owner",
      action: "bank export generated",
      resource: "Sep 16–30, 2026",
      metadata: {
        runId: 77,
        kind: "bank",
        dryRun: false,
        template: "BDO DAT",
        filename: "payroll-77-bdo.dat",
      },
      createdAt: new Date("2026-09-30T02:05:00Z"),
    },
    {
      id: 3,
      actor: "Owner",
      action: "Payroll payout completed manually",
      resource: "Sep 16–30, 2026",
      metadata: {
        runId: 77,
        method: "bank-file",
        reference: "BDO-BATCH-004821",
        completedAt: "2026-09-30T02:15:00Z",
      },
      createdAt: new Date("2026-09-30T02:15:00Z"),
    },
  ];

  const state = derivePayrollPayoutState(events, 77);
  assert.equal(state.release.done, true);
  assert.equal(state.bankFile.status, "generated");
  assert.equal(state.bankFile.filename, "payroll-77-bdo.dat");
  assert.equal(state.payout.status, "completed");
  assert.equal(state.payout.reference, "BDO-BATCH-004821");
});

test("payout completion route requires released bank-file evidence and explicit confirmation", () => {
  const route = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  const exportsView = read("src/components/workspace/exports.tsx");
  const payrollView = read("src/components/workspace/payroll-run.tsx");

  for (const marker of [
    'body.mode === "complete-manual"',
    "Generate the final released bank file before recording payout completion.",
    "Confirm that the bank or payment provider shows this payroll payout as completed.",
    "Payroll payout completed manually",
    "bankExportEventId",
    "moneyMovedByLinaw: false",
  ]) {
    assert.ok(route.includes(marker), `payout completion route is missing ${marker}`);
  }

  for (const marker of [
    "PAYOUT COMPLETION",
    "Mark payout complete",
    "Linaw records your confirmation; it does not independently verify the bank transfer.",
    'data-payout-stage="bank-file"',
    'data-payout-stage="completed"',
  ]) {
    assert.ok(exportsView.includes(marker), `exports payout UX is missing ${marker}`);
  }

  assert.ok(payrollView.includes("Payout status"));
  assert.ok(payrollView.includes('data-payout-status={visibleReleaseReceipt.payout.status}'));
});


test("payroll payslip email delivery is durable, run-linked and recoverable", () => {
  const releaseRoute = read("src/app/api/payroll-runs/[id]/release/route.ts");
  const outboxRoute = read("src/app/api/outbox/route.ts");
  const mailer = read("src/lib/mailer.ts");
  const scheduler = read("src/lib/scheduler.ts");
  const exportsView = read("src/components/workspace/exports.tsx");

  for (const marker of [
    "payrollRunId: run.id",
    "employeeId: person.id",
    "sentNotices",
    "queuedNotices",
    "failedNotices",
    "noticesSent",
    "noticesFailed",
  ]) {
    assert.ok(releaseRoute.includes(marker), `release email accounting is missing ${marker}`);
  }

  for (const marker of [
    "attemptOutboxDelivery",
    'status: "sending"',
    "attemptCount",
    "nextAttemptAt",
    "providerMessageId",
    "retryPayrollRunOutbox",
    "drainDueOutboxRetries",
    "MAX_AUTO_ATTEMPTS",
  ]) {
    assert.ok(mailer.includes(marker), `durable outbox is missing ${marker}`);
  }

  assert.ok(scheduler.includes("drainDueOutboxRetries(25)"), "scheduler must drain due email retries");
  assert.ok(outboxRoute.includes("payrollRunOutboxHealth"));
  assert.ok(outboxRoute.includes('action: "Payroll email delivery retried"'));

  for (const marker of [
    "PAYSLIP EMAIL DELIVERY",
    "Refresh delivery status",
    "Retry queued / failed",
    "data-payroll-email-message-list",
    "providerMessageId",
    "attemptCount",
  ]) {
    assert.ok(exportsView.includes(marker), `email delivery UX is missing ${marker}`);
  }
});
