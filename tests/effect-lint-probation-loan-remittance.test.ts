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

test("government loan remittance panel remounts by employer and loads asynchronously", () => {
  const source = read(LOAN);
  assert.match(source, /GovernmentLoanRemittancePanelContent key=\{props\.organizationId\}/);
  assert.match(source, /const load = useCallback\(async \(signal\?: AbortSignal\): Promise<GovernmentLoanRead \| null> => \{/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(controller\.signal\.aborted\) return;\s*void load\(controller\.signal\);/);
  assert.match(source, /setSnapshot\(null\)/, "Clear stale remittance evidence on each load");
  assert.match(source, /catch \{[\s\S]*?setReadError\(/, "Internal errors explicitly mark verification unavailable");
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /if \(signal\?\.aborted\) return/);
  assert.match(source, /if \(!refreshed \|\| !isConfirmedGovernmentLoanMutation\(action, payload, body, refreshed\)\)/,
    "A successful POST alone cannot confirm a payment or posting");
  assert.match(source, /setSnapshot\(null\);\s*setReadError\(uncertain\);\s*setNotice\(uncertain\)/,
    "Unconfirmed read-after-write must disable further mutations and warn");
  assert.match(source, /may already have been recorded/,
    "POST success followed by GET failure is not permission to blindly retry");
  assert.match(source, /Retry employer access/, "403 has an explicit retry path");
});

test("only resolved per-file React effect allowances are removed", () => {
  const baseline = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(baseline[PROBATION], undefined);
  assert.equal(baseline[LOAN], undefined);
});
