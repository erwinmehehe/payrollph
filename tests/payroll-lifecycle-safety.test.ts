import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPayrollHandoff, employeePayStatusLabel } from "../src/lib/payroll-handoff";

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


test("payroll handoff notifications target the next authorized role after commit", () => {
  const submit = read("src/app/api/payroll-runs/[id]/submit-review/route.ts");
  const approval = read("src/app/api/approvals/[id]/route.ts");
  const release = read("src/app/api/payroll-runs/[id]/release/route.ts");
  const mailer = read("src/lib/mailer.ts");

  assert.ok(mailer.includes("export async function queueMessageOnce"));
  assert.ok(mailer.includes("eq(outbox.purpose, input.purpose)"));

  assert.ok(submit.includes("recipient: checker.email"));
  assert.ok(submit.includes('purpose: `payroll-review-${run.id}-${checker.id}`'));
  assert.ok(
    submit.indexOf("queueMessageOnce({") > submit.indexOf("if (!submission)"),
    "checker mail must happen only after the review transaction succeeds",
  );

  assert.ok(approval.includes("PAYROLL_RELEASE_ROLES"));
  assert.ok(approval.includes("roleAllowed(member.role, PAYROLL_RELEASE_ROLES)"));
  assert.ok(approval.includes('subject: `Payroll ready for release: ${payrollRunForNotification.periodLabel}`'));
  assert.ok(approval.includes('purpose: `payroll-returned-${payrollRunId}-${maker.id}`'));
  assert.ok(
    approval.indexOf("let handoffNotification") > approval.indexOf("updated = await db.transaction"),
    "approval mail must not run inside the decision transaction",
  );

  assert.ok(release.includes("queueMessageOnce({"));
  assert.ok(release.includes('purpose: `payslip-ready-${runId}-${person.id}`'));
  assert.ok(
    release.indexOf("queueMessageOnce({") > release.indexOf("settlePayrollRun"),
    "employee mail must happen only after payroll settlement succeeds",
  );
});

test("handoff mail failure cannot turn a committed payroll transition into a failed response", () => {
  const submit = read("src/app/api/payroll-runs/[id]/submit-review/route.ts");
  const approval = read("src/app/api/approvals/[id]/route.ts");
  const release = read("src/app/api/payroll-runs/[id]/release/route.ts");

  assert.ok(submit.includes("The review was submitted, but the checker notification could not be queued."));
  assert.ok(approval.includes("Payroll was approved, but the release-authority notification could not be queued."));
  assert.ok(approval.includes("Payroll was returned for changes, but the maker notification could not be queued."));
  assert.ok(release.includes("postReleaseWarnings"));
});


test("outbox UI hides internal payroll notification dedupe keys", () => {
  const panels = read("src/components/workspace/panels.tsx");
  assert.ok(panels.includes('purpose.startsWith("payroll-review-")'));
  assert.ok(panels.includes('return "Payroll review"'));
  assert.ok(panels.includes('purpose.startsWith("payroll-release-")'));
  assert.ok(panels.includes('return "Ready for release"'));
  assert.ok(panels.includes('purpose.startsWith("payroll-returned-")'));
  assert.ok(panels.includes('return "Payroll returned"'));
  assert.ok(panels.includes('purpose.startsWith("payslip-ready-")'));
  assert.ok(panels.includes('return "Payslip ready"'));
  assert.ok(panels.includes("outboxPurposeLabel(String(msg.purpose ?? \"\"))"));
});
