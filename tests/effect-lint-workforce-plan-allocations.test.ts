import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  effectiveWorkforcePlanId,
  scopedWorkforceAllocationId,
} from "../src/lib/workforce-plan-allocation-view";

const FILE = "src/components/workforce-plan-allocation-panel.tsx";
const read = () => readFileSync(FILE, "utf8");

test("the first available workforce plan is chosen without effect-driven state writes", () => {
  assert.equal(effectiveWorkforcePlanId([], ""), "");
  assert.equal(effectiveWorkforcePlanId([{ id: 11 }, { id: 12 }], ""), "11");
  assert.equal(effectiveWorkforcePlanId([{ id: 11 }, { id: 12 }], "12"), "12");
  // A previously selected plan that disappears must NOT silently authorize
  // a different plan's manager request.
  assert.equal(effectiveWorkforcePlanId([{ id: 11 }], "12"), "12");
  assert.equal(effectiveWorkforcePlanId([{ id: 11 }], "0"), "0");
});

test("only an allocation from the currently displayed plan can be submitted", () => {
  const plan1 = [{ id: 101 }, { id: 102 }];
  const plan2 = [{ id: 201 }];
  assert.equal(scopedWorkforceAllocationId(plan1, "101"), "101");
  assert.equal(scopedWorkforceAllocationId(plan2, "101"), "");
  assert.equal(scopedWorkforceAllocationId(plan1, "201"), "");
  assert.equal(scopedWorkforceAllocationId(plan1, ""), "");
  assert.equal(scopedWorkforceAllocationId([], "101"), "");
  // Every ID is compared exactly. A partial or numerically ambiguous value
  // cannot select an allocation that the user did not actually choose.
  assert.equal(scopedWorkforceAllocationId(plan1, "0101"), "");
});

test("the entire allocation/request editor remounts when the employer changes", () => {
  const source = read();
  assert.match(source, /WorkforcePlanAllocationContent key=\{props\.organizationId\}/);
  assert.ok(source.indexOf("function WorkforcePlanAllocationContent(") < source.indexOf("const [allocations, setAllocations]"));
  assert.ok(source.indexOf("function WorkforcePlanAllocationContent(") < source.indexOf("const [decisionNotes, setDecisionNotes]"));
  assert.match(source, /const selectedPlanId = effectiveWorkforcePlanId\(plans, selectedPlanIdDraft\)/);
  assert.match(source, /const selectedAllocationId = scopedWorkforceAllocationId\(planAllocations, submissionForm\.allocationId\)/);
  assert.match(source, /value=\{selectedAllocationId\}/);
  assert.match(source, /setSubmissionForm\(\(current\) => current\.allocationId \? \{ \.\.\.current, allocationId: "" \} : current\)/);
  assert.match(source, /current\.allocationId && !nextAllocations\.some\(\(row\) => String\(row\.id\) === current\.allocationId\)/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*if \(!selectedPlanId && plans\.length\)/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*if \(\s*submissionForm\.allocationId/);
});

test("initial read is abortable and last-request-owned, with no synchronous state-setting effects", () => {
  const source = read();
  assert.match(source, /const load = useCallback\(async \(signal\?: AbortSignal\) =>/);
  assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(source, /const isCurrent = \(\) => !signal\?\.aborted && revision === loadRevisionRef\.current/);
  assert.match(source, /\{ cache: "no-store", signal \}/);
  assert.match(source, /if \(!isCurrent\(\)\) return;/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{/);
  assert.match(source, /if \(!controller\.signal\.aborted\) void load\(controller\.signal\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /loadRevisionRef\.current \+= 1/);
  assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1);
});

test("manager writes, role-scoped visibility, review decisions and finance ceilings stay enforced", () => {
  const source = read();
  for (const invariant of [
    'entityType: "allocation"',
    'entityType: "submission"',
    'allocationId: selectedAllocation.id',
    'method: "POST"',
    'method: "PATCH"',
    'action === "submit"',
    'action === "accept"',
    'submissionAction(submission.id, "reject")',
    'access?.canManageAllocations',
    'submission.canDecide',
    'submission.canSubmit',
    'loadedOrganizationId !== organizationId',
    'loading || (!loadError && loadedOrganizationId !== organizationId)',
    'max={selectedAllocation?.headcountCeiling}',
    'selectedAllocation ? Number(selectedAllocation.annualBudgetCeiling) : undefined',
  ]) assert.ok(source.includes(invariant), "Missing secured planning boundary: " + invariant);
  const manifest = JSON.parse(readFileSync("eslint-suppressions.json", "utf8")) as Record<string, unknown>;
  // Do not pin the global count; another #774 batch may reduce it further.
  assert.equal(manifest[FILE], undefined);
});
