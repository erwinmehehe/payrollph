import assert from "node:assert/strict";
import test from "node:test";
import { buildPayrollOfficerWorkflow } from "../src/lib/payroll-officer-workflow";

test("payroll officer workflow keeps calculation current until server checklist is complete", () => {
  const result = buildPayrollOfficerWorkflow({
    runStatus: "Processing",
    calculated: true,
    processedChunks: 1,
    totalChunks: 2,
    exceptionCount: 0,
    checklist: [
      { key: "inputs", passed: true, blocking: true, detail: "ok" },
      { key: "attendance", passed: true, blocking: true, detail: "ok" },
      { key: "calculation", passed: false, blocking: true, detail: "incomplete" },
    ],
  });

  assert.equal(result.calculationReady, false);
  assert.equal(result.steps.calculate.state, "now");
  assert.equal(result.steps.exceptions.state, "locked");
  assert.equal(result.canSubmit, false);
});

test("input and exception attention are surfaced without inventing new payroll rules", () => {
  const result = buildPayrollOfficerWorkflow({
    runStatus: "Needs review",
    calculated: true,
    processedChunks: 2,
    totalChunks: 2,
    exceptionCount: 2,
    checklist: [
      { key: "inputs", passed: false, blocking: true, detail: "missing input" },
      { key: "attendance", passed: true, blocking: true, detail: "ok" },
      { key: "calculation", passed: true, blocking: true, detail: "complete" },
      { key: "statutory", passed: true, blocking: true, detail: "ok" },
      { key: "exceptions", passed: false, blocking: true, acknowledgeable: true, detail: "review" },
    ],
  });

  assert.equal(result.steps.inputs.state, "attention");
  assert.equal(result.steps.exceptions.state, "attention");
  assert.equal(result.exceptionIssues, 2);
  assert.equal(result.canSubmit, false);
});

test("submission stage reflects the maker-checker state", () => {
  const pending = buildPayrollOfficerWorkflow({
    runStatus: "Pending approval",
    calculated: true,
    processedChunks: 2,
    totalChunks: 2,
    exceptionCount: 0,
    approvalStatus: "Pending",
    checklist: [{ key: "calculation", passed: true, blocking: true, detail: "complete" }],
  });
  assert.equal(pending.steps.submit.state, "now");
  assert.equal(pending.canSubmit, false);

  const approved = buildPayrollOfficerWorkflow({
    runStatus: "Ready for release",
    calculated: true,
    processedChunks: 2,
    totalChunks: 2,
    exceptionCount: 0,
    approvalStatus: "Approved",
    checklist: [{ key: "calculation", passed: true, blocking: true, detail: "complete" }],
  });
  assert.equal(approved.steps.submit.state, "done");
  assert.equal(approved.canSubmit, false);
});


test("payroll officer UI hides the generic release handoff rail", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  assert.match(source, /\{!payrollOfficerMode(?: && !ownerMode)? && \(/);
  assert.ok(source.includes("<PayrollHandoff"));
  assert.ok(source.includes("<PayrollOfficerWorkspace"));
});

test("release checklist exposes safe assurance findings for direct employee deep-links", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("src/app/api/payroll-runs/[id]/release-checklist/route.ts", "utf8");
  const workspace = readFileSync("src/components/workspace/payroll-officer-workspace.tsx", "utf8");
  assert.ok(route.includes("assuranceFindings"));
  assert.ok(route.includes("employeeId: finding.employeeId ?? null"));
  assert.ok(!route.includes("current: finding.current"));
  assert.ok(workspace.includes("finding.employeeId"));
  assert.ok(workspace.includes('attendanceIssue ? "Fix time" : employeeRecordIssue ? "Open employee" : "Explain pay"'));
  assert.ok(workspace.includes("onOpenTimeIssue(employeeId)"));
  assert.ok(workspace.includes("onOpenEmployee(employeeId)"));
  assert.ok(workspace.includes("onExplainEmployee(employeeId)"));
});

test("generic statutory attention never opens the first employee by accident", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/components/workspace/payroll-officer-workspace.tsx", "utf8");
  assert.ok(!source.includes("onExplainEmployee(entries[0].employeeId)"));
  assert.ok(source.includes("hasStatutoryFinding"));
  assert.ok(source.includes("hasAttendanceFinding"));
});


test("reviewable exceptions can still be handed to Checker once required inputs and calculation are complete", () => {
  const result = buildPayrollOfficerWorkflow({
    runStatus: "Needs review",
    calculated: true,
    processedChunks: 2,
    totalChunks: 2,
    exceptionCount: 2,
    checklist: [
      { key: "inputs", passed: true, blocking: true, detail: "ok" },
      { key: "attendance", passed: true, blocking: true, detail: "ok" },
      { key: "calculation", passed: true, blocking: true, detail: "complete" },
      { key: "statutory", passed: false, blocking: true, detail: "review" },
      { key: "exceptions", passed: false, blocking: true, acknowledgeable: true, detail: "review" },
    ],
  });

  assert.equal(result.steps.inputs.state, "done");
  assert.equal(result.steps.exceptions.state, "attention");
  assert.equal(result.steps.submit.state, "now");
  assert.equal(result.canSubmit, true);
});

test("checker submission endpoint enforces required input and calculation readiness server-side", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/app/api/payroll-runs/[id]/submit-review/route.ts", "utf8");
  assert.ok(source.includes("buildPayrollReleaseChecklist"));
  assert.ok(source.includes('item.key === "inputs" || item.key === "calculation"'));
  assert.ok(source.includes("Payroll inputs and calculation must be complete before checker submission."));
  assert.ok(source.includes("blockingWorkflowItems"));
});


test("payroll officer calculation control is disabled while server processing is already active", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/components/workspace/payroll-officer-workspace.tsx", "utf8");
  assert.ok(source.includes('["Queued", "Processing", "Recalculating"].includes(run.status)'));
  assert.ok(source.includes("disabled={busy || !canCalculate}"));
  assert.ok(source.includes('calculationInProgress ? "Processing"'));
});
