import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PROBATION = "src/components/hcm-probation-review-panel.tsx";
const LOAN = "src/components/government-loan-remittance-panel.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("probation review panel remounts by employment term and loads asynchronously", () => {
  const source = read(PROBATION);
  assert.match(source, /HcmProbationReviewPanelContent key=\{`\$\{props\.organizationId\}:\$\{props\.employeeId\}:\$\{props\.employmentTermId\}`\}/);
  assert.match(source, /const load = useCallback\(async \(signal\?: AbortSignal\) => \{\s*setError\(""\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(!controller\.signal\.aborted\) void load\(controller\.signal\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /if \(signal\?\.aborted\) return/);
  // The refresh button still calls load() directly on click; unchanged.
  assert.ok(source.includes("onClick={() => void load()}"));
});

// Loan loading, employer switching, ignored-abort late responses and mutation
// confirmation execute in government-loan-ui-browser.mjs and the focused read tests.

test("only resolved per-file React effect allowances are removed", () => {
  const baseline = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(baseline[PROBATION], undefined);
  assert.equal(baseline[LOAN], undefined);
});
