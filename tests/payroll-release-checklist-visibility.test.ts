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
  const current = scope(10, 42);
  const approved: ObservedPayrollReleaseChecklist<{ ready: boolean }> = {
    scope: current,
    checklist: { ready: true },
  };
  assert.deepEqual(visiblePayrollReleaseChecklist(current, approved), { ready: true });

  for (const mismatched of [
    scope(11, 42),
    scope(10, 43),
    scope(10, null),
    scope(10, 42, [{ id: 42 }], tasks),
    scope(10, 42, runs, [{ id: 5, status: "Pending" }]),
    scope(10, 42), // A -> B -> A must not show the first A response again.
  ]) {
    assert.equal(visiblePayrollReleaseChecklist(mismatched, approved), null,
      "old readiness must not be used to release a different snapshot");
  }
  assert.equal(visiblePayrollReleaseChecklist(scope(10, 42), null), null);
});

test("server denial or load failure never grants readiness for a matching run", () => {
  const current = scope(10, 42);
  assert.equal(visiblePayrollReleaseChecklist(current, {
    scope: current,
    checklist: null,
  }), null);
  assert.deepEqual(visiblePayrollReleaseChecklist(current, {
    scope: current,
    checklist: { ready: false, blocking: true },
  }), { ready: false, blocking: true });
});

test("payroll run explicitly aborts obsolete reads and removes synchronous effect clearing", () => {
  const source = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  assert.match(source, /visiblePayrollReleaseChecklist\(checklistScope, checklistObservation\)/);
  assert.match(source, /const checklistScope = useMemo\(\(\) => \(\{/);
  assert.match(source, /const requestScope = checklistScope/);
  assert.match(source, /organizationId: data\.selectedOrganization\.id/);
  assert.match(source, /payrollRuns: data\.payrollRuns/);
  assert.match(source, /tasks: data\.tasks/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /return \(\) => \{ active = false; controller\.abort\(\); \}/);
  assert.match(source, /const body: unknown = await response\.json\(\)/);
  assert.match(source, /if \(!isVerifiedReleaseChecklist\(body, \{/,
    "a 200 response must not bypass complete release-checklist validation");
  assert.match(source, /organizationId: data\.selectedOrganization\.id,\s*legalEntityId: run\?\.legalEntityId \?\? null,\s*runId,/,
    "validation must bind the selected employer, legal entity and current run");
  assert.match(source, /if \(active\) setChecklistObservation\(\{ scope: requestScope, checklist: null \}\)/,
    "denial, malformed JSON or mismatched employer data must remove release readiness");
  assert.match(source, /if \(active\) setChecklistObservation\(\{ scope: requestScope, checklist: body \}\)/,
    "only the verified response may become a visible checklist");
  assert.doesNotMatch(source, /setReleaseChecklist\(null\)/);
});

test("payroll release stays blocked until its exact checklist loads and confirmation matches its scope", () => {
  const source = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
  assert.ok(source.includes("const hardChecklistBlocked = !releaseChecklist || releaseChecklist.items.some("),
    "an absent or loading checklist must block release controls");
  assert.match(source, /const confirmRelease =\s*entriesVerified && confirmReleaseForScope === checklistScope && releaseChecklist !== null;/,
    "dialog visibility must require a verified register plus the exact checklist and approval snapshot");
  assert.ok(source.includes("setConfirmReleaseForScope(checklistScope)"),
    "the dialog must capture the scope the user actually confirmed");
  assert.ok(source.includes("setConfirmReleaseForScope(null)"),
    "closing the dialog must clear the saved scope");
  assert.ok(!source.includes("[confirmRelease, setConfirmRelease] = useState(false)"),
    "a global boolean must never carry release confirmation across payroll runs");
});
