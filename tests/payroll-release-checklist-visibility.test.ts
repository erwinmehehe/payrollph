import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  visiblePayrollReleaseChecklist,
  type PayrollReleaseChecklistScope,
  type ObservedPayrollReleaseChecklist,
} from "../src/lib/payroll-release-checklist-visibility";

const runs = [{ id: 42 }];
const tasks = [{ id: 5, status: "Approved" }];
const scope = (organizationId: number, runId: number | null, payrollRuns: unknown = runs, approvals: unknown = tasks):
  PayrollReleaseChecklistScope => ({ organizationId, runId, payrollRuns, tasks: approvals });

test("a release checklist is only visible for the exact employer, run, and approval inputs", () => {
  const approved: ObservedPayrollReleaseChecklist<{ ready: boolean }> = {
    scope: scope(10, 42),
    checklist: { ready: true },
  };
  assert.deepEqual(visiblePayrollReleaseChecklist(scope(10, 42), approved), { ready: true });

  for (const mismatched of [
    scope(11, 42),
    scope(10, 43),
    scope(10, null),
    scope(10, 42, [{ id: 42 }], tasks),
    scope(10, 42, runs, [{ id: 5, status: "Pending" }]),
  ]) {
    assert.equal(visiblePayrollReleaseChecklist(mismatched, approved), null,
      "old readiness must not be used to release a different snapshot");
  }
  assert.equal(visiblePayrollReleaseChecklist(scope(10, 42), null), null);
});

test("server denial or load failure never grants readiness for a matching run", () => {
  assert.equal(visiblePayrollReleaseChecklist(scope(10, 42), {
    scope: scope(10, 42),
    checklist: null,
  }), null);
  assert.deepEqual(visiblePayrollReleaseChecklist(scope(10, 42), {
    scope: scope(10, 42),
    checklist: { ready: false, blocking: true },
  }), { ready: false, blocking: true });
});

test("payroll run explicitly aborts obsolete reads and removes synchronous effect clearing", () => {
  const source = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  assert.match(source, /visiblePayrollReleaseChecklist\(checklistScope, checklistObservation\)/);
  assert.match(source, /organizationId: data\.selectedOrganization\.id/);
  assert.match(source, /payrollRuns: data\.payrollRuns/);
  assert.match(source, /tasks: data\.tasks/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /return \(\) => \{ active = false; controller\.abort\(\); \}/);
  assert.match(source, /if \(active\) setChecklistObservation\(\{ scope: requestScope, checklist \}\)/);
  assert.doesNotMatch(source, /setReleaseChecklist\(null\)/);
});
