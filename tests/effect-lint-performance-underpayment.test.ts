import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PERFORMANCE = "src/components/performance-panel.tsx";
const UNDERPAYMENT = "src/components/payroll-underpayment-panel.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("performance panel remounts by employer and loads asynchronously", () => {
  const source = read(PERFORMANCE);
  assert.match(source, /PerformancePanelContent key=\{props\.organizationId\}/);
  assert.match(source, /const \[loading, setLoading\] = useState\(true\)/);
  assert.doesNotMatch(source, /const load = useCallback\(async \(\) => \{\s*setLoading\(true\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(!controller\.signal\.aborted\) void load\(controller\.signal\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.ok(source.includes("onClick={() => { setLoading(true); void load(); }}"));
  assert.match(source, /if \(signal\?\.aborted\) return/);
});

test("payroll underpayment panel remounts by employer and loads asynchronously", () => {
  const source = read(UNDERPAYMENT);
  assert.match(source, /PayrollUnderpaymentPanelContent key=\{props\.organizationId\}/);
  assert.match(source, /const \[loading, setLoading\] = useState\(true\)/);
  assert.doesNotMatch(source, /let mounted = true;\s*void load\(\)\.finally/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(!controller\.signal\.aborted\) void load\(controller\.signal\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /if \(signal\?\.aborted\) return/);
  assert.match(source, /if \(!signal\?\.aborted\) setLoading\(false\)/);
});

test("only resolved per-file React effect allowances are removed", () => {
  const baseline = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(baseline[PERFORMANCE], undefined);
  assert.equal(baseline[UNDERPAYMENT], undefined);
});
