import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel } from "../src/lib/payroll-handoff";
import { derivePayrollPayoutState } from "../src/lib/payroll-payout-state";
import { payrollPayoutProviderForReleaseReceipt } from "../src/lib/payroll-payout-provider";

const read = (path: string) => readFileSync(path, "utf8");

// Converted the former Active-only source-text assertion to executed HTTP/PG
// status/scope tests in scripts/qa/payroll-approved-exit-http.mjs: actual draft
// creation, flag-off query, separating-worker inclusion and settlement guards.

test("calculation snapshots payout instructions and release rejects stale employee data", () => {
  const engine = read("src/lib/payroll-engine.ts");
  const settlement = read("src/lib/payroll-settlement.ts");

  assert.ok(engine.includes("payment: {"));
  assert.ok(engine.includes("payProfile: {"));
  assert.ok(engine.includes("bankAccount: sealedPaymentBankAccounts.get(employee.id) ?? null"));
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
  assert.ok(engine.includes("tx.delete(payrollEntries)"), "Register deletion must occur within the row-locked enqueue transaction");
  assert.ok(engine.includes("tx.delete(payrollJobs)"), "Job reset must occur within the same transaction");
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
    "Xendit is the selected payout rail.",
    "PayMongo is selected for this employer.",
    "Run the no-money PayMongo preflight",
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

test("payout completion UX keeps Xendit opt-in and preserves historical PayMongo and bank fallback", () => {
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
    "Xendit is an opt-in salary payout rail",
    "<XenditPayoutPanel",
    'data-payout-stage="paymongo-preflight"',
    'data-payout-stage="completed"',
  ]) {
    assert.ok(exportsView.includes(marker), `exports payout UX is missing ${marker}`);
  }

  assert.ok(payrollView.includes("Payout status"));
  assert.ok(payrollView.includes('data-payout-status={visibleReleaseReceipt.payout.status}'));
});


test("release receipt records selected payout provider and keeps bank files optional", () => {
  const releaseRoute = read("src/app/api/payroll-runs/[id]/release/route.ts");
  const payrollView = read("src/components/workspace/payroll-run.tsx");
  const types = read("src/components/workspace/types.ts");

  assert.ok(releaseRoute.includes('status: "waiting" as const'));
  assert.ok(releaseRoute.includes('status: "awaiting-preflight" as const'));
  assert.ok(releaseRoute.includes("Optional fallback: no final bank file has been generated."));
  // Execute the same selection used to build the post-commit receipt:
  // bad configuration may be reported, but cannot throw after release.
  assert.equal(payrollPayoutProviderForReleaseReceipt({}), "paymongo");
  assert.equal(payrollPayoutProviderForReleaseReceipt({
    PAYROLL_PAYOUT_PROVIDER: "xendit",
  }), null);
  assert.equal(payrollPayoutProviderForReleaseReceipt({
    PAYROLL_PAYOUT_PROVIDER: "xendit", XENDIT_PAYOUTS_ENABLED: "true",
  }), "xendit");
  assert.equal(payrollPayoutProviderForReleaseReceipt({
    PAYROLL_PAYOUT_PROVIDER: "unsupported",
  }), null);
  assert.ok(payrollView.includes('data-payout-status={visibleReleaseReceipt.payout.status}'));
  assert.ok(types.includes('"awaiting-preflight" | "ready" | "submitted" | "completed"'));
});


test("provider-specific payout controls preserve ledger ownership and forbid duplicate bank files", () => {
  const exportsRoute = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  const xenditRoute = read("src/app/api/payroll-runs/[id]/xendit-payout/route.ts");
  const operations = read("src/lib/xendit-payroll-operations.ts");
  const exportsUi = read("src/components/workspace/exports.tsx");
  const panel = read("src/components/workspace/xendit-payout-panel.tsx");

  assert.ok(exportsRoute.includes("PAYROLL_PAYOUT_LEDGER_ALREADY_CLAIMED"));
  assert.ok(exportsRoute.includes('if (kind === "bank" && !dryRun)'));
  assert.ok(exportsRoute.includes("eq(payoutBatches.payrollRunId, run.id)"));
  assert.ok(operations.includes("XENDIT_PREVIOUS_PAYOUT_OR_BANK_FILE_UNCERTAIN"));
  assert.ok(operations.includes("await assertNoPriorPayrollDisbursement(run);"));
  assert.ok(xenditRoute.includes("claimedProvider: existing?.provider ?? null"));
  assert.ok(xenditRoute.includes('existing?.provider === "paymongo"'));
  assert.ok(xenditRoute.includes('action === "reconcile" || action === "resolve-unknown"'));
  assert.ok(panel.includes('status?.selectedProvider === "paymongo" && !status.claimedProvider && allowPaymongoActions'));
  assert.ok(panel.includes("Run PayMongo preflight"));
  assert.ok(panel.includes("Submit via PayMongo"));
  assert.ok(panel.includes('status?.selectedProvider === "xendit" && !claimedByPaymongo'));
  for (const marker of [
    "onPaymongoPreflight={runPaymongoPreflight}",
    "onPaymongoSubmit={submitPaymongoPayout}",
    "canSubmitPaymongo={payoutState?.payout.method",
    "paymongoPreflighting={preflightingPayout}",
    "paymongoSubmitting={submittingPayout}",
  ]) {
    assert.ok(exportsUi.includes(marker), "Missing selected-provider control: " + marker);
  }
});
