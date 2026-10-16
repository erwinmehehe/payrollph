import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checker = "src/components/workspace/checker-variance.tsx";
const inbox = "src/components/hcm-lifecycle-notification-inbox.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("checker variance remounts for the selected payroll run before showing old employee details", () => {
  const source = read(checker);
  assert.match(source, /CheckerVarianceContent key=\{props\.run\.id\}/);
  assert.match(source, /const \[payload, setPayload\] = useState<VariancePayload \| null>\(null\)/);
  assert.match(source, /const \[expanded, setExpanded\] = useState<Set<number>>\(new Set\(\)\)/);
  assert.doesNotMatch(source, /let alive = true;\s*setPayload\(null\)/);
  assert.match(source, /if \(!alive\) return;/);
  assert.match(source, /return \(\) => \{ alive = false; \}/);
  assert.match(source, /onDecide: \(id: number, status: "Approved" \| "Declined"\) => Promise<void>/);
});

test("lifecycle inbox uses abortable employer-owned reads; existing PATCH is unchanged", () => {
  const source = read(inbox);
  assert.match(source, /LifecycleNotificationContent key=\{props\.organizationId\}/);
  assert.match(source, /useScopedAsyncResource\(/);
  assert.match(source, /"hcm-lifecycle-notifications:" \+ organizationId/);
  assert.match(source, /async \(signal: AbortSignal\): Promise<Payload>/);
  assert.match(source, /cache: "no-store", signal/);
  assert.match(source, /Array\.isArray\(data\.tasks\)/);
  assert.match(source, /Array\.isArray\(data\.owners\)/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /await reload\(\)/);
  assert.match(source, /onChanged=\{reload\}/);
  assert.doesNotMatch(source, /useEffect\s*\(/);
});

test("checker and HCM resolved effect suppressions are absent from exact per-file lint debt", () => {
  const baseline = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(baseline[checker], undefined);
  assert.equal(baseline[inbox], undefined);
});
