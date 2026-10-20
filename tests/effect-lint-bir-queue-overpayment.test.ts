import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const BIR = "src/components/workspace/bir-1601c-remittance-panel.tsx";
const QUEUE = "src/components/workspace/statutory-remittance-action-queue.tsx";
const PREVIEW = "src/components/payroll-overpayment-preview-panel.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("BIR 1601-C panel remounts by employer and loads asynchronously", () => {
  const source = read(BIR);
  assert.match(source, /Bir1601cRemittancePanelContent key=\{props\.organizationId\}/);
  assert.match(source, /const load = useCallback\(async \(signal\?: AbortSignal\) => \{/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(controller\.signal\.aborted\) return;\s*void load\(controller\.signal\)\.catch/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /if \(signal\?\.aborted\) return/);
});

// Queue mount, explicit sync and employer remount are executed in
// scripts/qa/first-payroll-connected-browser.mjs, replacing brittle source matching.

test("overpayment preview remounts by employer instead of resetting state in the effect", () => {
  const source = read(PREVIEW);
  assert.match(source, /PayrollOverpaymentPreviewPanelContent key=\{props\.organizationId\}/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(cancelled\) return;/);
  assert.doesNotMatch(source, /setAvailable\(false\);\s*setOptions\(null\);\s*setPreview\(null\);\s*setValues\(INITIAL\)/);
  assert.match(source, /controller\.abort\(\)/);
});

test("only resolved per-file React effect allowances are removed", () => {
  const baseline = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  for (const file of [BIR, QUEUE, PREVIEW]) assert.equal(baseline[file], undefined, file);
});
