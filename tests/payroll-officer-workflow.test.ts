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
  assert.equal(result.canSubmit, true);
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
