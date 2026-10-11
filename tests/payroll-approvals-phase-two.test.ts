import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { PayrollPayoutState } from "../src/lib/payroll-payout-state";
import type { PayrollRun, Task, Delegation } from "../src/components/workspace/types";
import { assignedToViewer, decisionVisibleToViewer, viewerApprovalCounts } from "../src/lib/workspace-approval-eligibility";
import { payrollRunPresentation } from "../src/lib/payroll-workflow-presentation";

const day = "2026-10-11";
const now = new Date("2026-10-11T02:00:00Z");

const task = (approver: string, status = "Pending", id = 1): Task => ({
  id, title: "Review payroll", detail: "Payroll run #42",
  approver, status, dueLabel: "Current cycle", priority: "High",
});
const delegation = (fromApprover: string, toApprover: string, active = true, startsOn = "2026-10-01", endsOn = "2026-10-31"): Delegation => ({
  id: 1, fromApprover, toApprover, active, startsOn, endsOn, reason: "Approved leave",
});
const run = (status: string, overrides: Partial<PayrollRun> = {}): PayrollRun => ({
  id: 42, periodLabel: "October 1-15, 2026", periodStart: "2026-10-01", periodEnd: "2026-10-15",
  scopeLabel: "Regular", status, payDate: "2026-10-20",
  employeeCount: 26, grossPay: "200000", netPay: "170000", exceptions: 0, ruleVersion: "v1",
  ...overrides,
});
function payout(status: PayrollPayoutState["payout"]["status"]): PayrollPayoutState {
  return {
    release: { done: status !== "awaiting-preflight", at: null },
    bankFile: { status: "waiting", filename: null, template: null, generatedAt: null },
    payout: { status, label: status, reference: null, method: null, completedAt: null },
    reconciliation: {
      provider: null, status: "not-applicable", batchIds: [],
      total: 0, succeeded: 0, pending: 0, failed: 0, unknown: 0,
      checkedAt: null, canRetryFailed: false, settlementRegressed: false, transfers: [],
    },
  };
}
const presentation = (
  status: string, approvalTask: Task | null = null, payoutStatus: PayrollPayoutState["payout"]["status"] = "awaiting-preflight",
  overrides: Partial<PayrollRun> = {},
) => payrollRunPresentation({
  run: run(status, overrides), approvalTask, payout: payout(payoutStatus),
  checklist: [{ blocking: true, passed: true }], now,
});

test("named approvers match regardless of case but unrelated colleagues do not", () => {
  assert.equal(assignedToViewer("Maya Cruz", "maya cruz", "hr", [], day), true);
  assert.equal(assignedToViewer("Mariel Santos", "Maya Cruz", "checker", [], day), false);
  assert.equal(assignedToViewer("Maya Cruz", "", "owner", [], day), false);
});

test("role-target approvals only match permitted roles", () => {
  assert.equal(assignedToViewer("role:hr", "Aira", "hr", [], day), true);
  assert.equal(assignedToViewer("role:finance", "Bea", "bookkeeper", [], day), true);
  assert.equal(assignedToViewer("role:manager", "Andrea", "owner", [], day), true);
  assert.equal(assignedToViewer("role:owner", "Bea", "bookkeeper", [], day), false);
  assert.equal(assignedToViewer("role:hr", "Paolo", "payroll", [], day), false);
});

test("delegations must be active and within an inclusive date window", () => {
  assert.equal(assignedToViewer("Maya", "Ana", "hr", [delegation("Maya", "Ana")], day), true);
  assert.equal(assignedToViewer("Maya", "Ana", "hr", [delegation("Maya", "Ana", false)], day), false);
  assert.equal(assignedToViewer("Maya", "Ana", "hr", [delegation("Maya", "Ana", true, "2026-10-12")], day), false);
  assert.equal(assignedToViewer("Maya", "Ana", "hr", [delegation("Maya", "Ana", true, "2026-09-30", "2026-10-10")], day), false);
  assert.equal(assignedToViewer("Maya", "Ana", "hr", [delegation("Maya", "Ana", true, day, day)], day), true);
});

test("delegation chain stops after three edges and never loops", () => {
  const chain = [delegation("Maya", "Ana"), delegation("Ana", "Luis"), delegation("Luis", "Bea"), delegation("Bea", "Zoe")];
  assert.equal(assignedToViewer("Maya", "Bea", "checker", chain, day), true);
  assert.equal(assignedToViewer("Maya", "Zoe", "checker", chain, day), false);
  assert.equal(assignedToViewer("Maya", "Zoe", "checker", [delegation("Maya", "Ana"), delegation("Ana", "Maya")], day), false);
});

test("task decisions are hidden for decided tasks and unauthorized roles", () => {
  const identity = { actorName: "Maya Cruz", role: "hr", delegations: [], today: day, canDecide: true };
  assert.equal(decisionVisibleToViewer({ ...identity, task: task("Maya Cruz") }), true);
  assert.equal(decisionVisibleToViewer({ ...identity, task: task("Maya Cruz", "Approved") }), false);
  assert.equal(decisionVisibleToViewer({ ...identity, task: task("Mariel Santos") }), false);
  assert.equal(decisionVisibleToViewer({ ...identity, task: task("Maya Cruz"), canDecide: false }), false);
});

test("approval counts distinguish user-owned decisions from company-wide queue", () => {
  const tasks = [task("Maya", "Pending", 1), task("Mariel", "Pending", 2), task("role:hr", "Pending", 3), task("Maya", "Approved", 4)];
  const result = viewerApprovalCounts({ tasks, actorName: "Maya", role: "hr", delegations: [], canDecide: true, today: day });
  assert.deepEqual(result, { pending: 3, mine: 2, high: 3, decided: 1 });
});

test("payroll review stage is preliminary while cutoff is open", () => {
  const result = presentation("Needs review");
  assert.equal(result.currentStage, "review");
  assert.equal(result.preliminary, true);
  assert.equal(result.stages[0].state, "done");
  assert.equal(result.stages[1].state, "current");
  assert.equal(result.stages[4].state, "waiting");
  assert.equal(result.employeeDeductions, 30000);
  assert.equal(result.netPay, 170000);
});

test("checker pending, approved, and released are distinct stages", () => {
  assert.equal(presentation("Pending approval", task("Mariel")).currentStage, "approve");
  assert.equal(presentation("Ready for release", task("Mariel", "Approved")).currentStage, "release");
  const released = presentation("Released", task("Mariel", "Approved"));
  assert.equal(released.currentStage, "payout");
  assert.equal(released.stages[3].state, "done");
  assert.equal(released.stages[4].state, "current");
  assert.match(released.message, /has not been confirmed/);
});

test("payment submission is not payment completion", () => {
  const submitted = presentation("Released", task("Mariel", "Approved"), "submitted");
  assert.equal(submitted.stages[4].state, "current");
  assert.match(submitted.message, /Do not assume employees have been paid/);
  const done = presentation("Released", task("Mariel", "Approved"), "completed");
  assert.equal(done.stages.every((stage) => stage.state === "done"), true);
});

test("failed and uncalculated runs cannot appear ready", () => {
  const failed = presentation("Failed");
  assert.equal(failed.currentStage, "prepare");
  assert.equal(failed.calculated, false);
  assert.match(failed.message, /Calculation failed/);
  const draft = presentation("Draft", null, "awaiting-preflight", { grossPay: "0", netPay: "0" });
  assert.equal(draft.currentStage, "prepare");
  assert.equal(draft.netPay, null);
});

test("unavailable checklist does not imply approval or release readiness", () => {
  const result = payrollRunPresentation({
    run: run("Ready for release"), approvalTask: task("Mariel", "Approved"),
    payout: payout("awaiting-preflight"), checklist: null, now,
  });
  assert.equal(result.currentStage, "release");
  assert.equal(result.blockerCount, null);
  assert.equal(result.released, false);
});

test("Phase 2 screens preserve confirmation and guarded payout separation", () => {
  const approvals = readFileSync("src/components/workspace/approvals.tsx", "utf8");
  const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  const banner = readFileSync("src/components/workspace/payroll-phase-two-overview.tsx", "utf8");
  const backend = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
  assert.match(approvals, /confirmDialog/);
  assert.match(approvals, /Review payroll evidence/);
  assert.ok(approvals.indexOf('className="card p2-approval-queue"') < approvals.indexOf('id="p2-checker-evidence"'), "task queue must appear before the long variance review");
  assert.match(banner, /moneyExact\(view\.grossPay\)/);
  assert.match(approvals, /draftPermitted/);
  assert.match(approvals, /canDecideTask\(task\)/);
  assert.match(payroll, /PayrollPhaseTwoOverview/);
  assert.match(payroll, /OwnerPayrollRelease/);
  assert.match(payroll, /PayrollOfficerWorkspace/);
  assert.match(banner, /Release does not mean paid/);
  assert.match(backend, /Maker-checker control/);
});
