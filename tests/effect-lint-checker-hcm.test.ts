import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checker = "src/components/workspace/checker-variance.tsx";
const inbox = "src/components/hcm-lifecycle-notification-inbox.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("checker variance scopes every read to employer, run and current verified snapshot", () => {
  const source = read(checker);
  const validator = read("src/lib/payroll-checker-variance-read.ts");
  assert.match(source, /CheckerVarianceContent key=\{\[props\.organizationId, props\.run\.id/);
  assert.match(source, /const \[observation, setObservation\] = useState</);
  assert.match(source, /const current = observation\?\.scopeKey === scopeKey \? observation : null/);
  assert.match(source, /const payload = current\?\.payload \?\? null/);
  assert.match(source, /const \[expanded, setExpanded\] = useState<Set<number>>\(new Set\(\)\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{/);
  assert.match(source, /readVerifiedPayrollCheckerVariance\(organizationId, run, fetch, controller\.signal\)/);
  assert.match(source, /if \(!controller\.signal\.aborted\) setObservation/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /Retry payroll variance/);
  assert.match(validator, /cache: "no-store", signal/);
  assert.match(source, /onDecide: \(id: number, status: "Approved" \| "Declined"\) => Promise<void>/);
  assert.doesNotMatch(source, /setPayload\(body\)/);
});

test("lifecycle inbox uses abortable employer-owned reads; existing PATCH is unchanged", () => {
  const source = read(inbox);
  assert.match(source, /LifecycleNotificationContent key=\{props\.organizationId\}/);
  assert.match(source, /useScopedAsyncResource\(/);
  assert.match(source, /"hcm-lifecycle-notifications:" \+ organizationId/);
  assert.match(source, /async \(signal: AbortSignal\): Promise<Payload>/);
  assert.match(source, /cache: "no-store", signal/);
  assert.match(source, /readVerifiedLifecycleNotificationResponse\(response\.ok, data, organizationId\)/);
  const validator = read("src/lib/hcm-lifecycle-notification-read.ts");
  assert.match(validator, /return ok && isVerifiedLifecycleNotificationQueue\(payload, organizationId\) \? payload : null/);
  assert.match(validator, /v\.organizationId !== organizationId/);
  assert.match(validator, /Array\.isArray\(v\.tasks\)/);
  assert.match(validator, /Array\.isArray\(v\.owners\)/);
  assert.match(source, /isVerifiedLifecycleNotificationReceipt\(data, organizationId, taskId, action, extra\)/);
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
