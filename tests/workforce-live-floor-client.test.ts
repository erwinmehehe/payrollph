import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activeLiveFloorSnapshot,
  isCurrentLiveFloorRequest,
  liveFloorScopeKey,
} from "../src/lib/workforce-live-floor-client";

test("live-floor snapshot stays hidden across tenant and worker-page changes", () => {
  const oldKey = liveFloorScopeKey(11, 2);
  const oldResponse = { scopeKey: oldKey, data: { rows: ["Tenant A worker"] } };
  assert.deepEqual(activeLiveFloorSnapshot(oldResponse, oldKey), oldResponse.data);
  assert.equal(activeLiveFloorSnapshot(oldResponse, liveFloorScopeKey(12, 2)), null);
  assert.equal(activeLiveFloorSnapshot(oldResponse, liveFloorScopeKey(11, 3)), null);
  assert.equal(activeLiveFloorSnapshot(null, oldKey), null);
});

test("only the latest un-aborted live-floor request can update visible state", () => {
  const first = new AbortController();
  const second = new AbortController();
  assert.ok(isCurrentLiveFloorRequest(first, first));
  assert.equal(isCurrentLiveFloorRequest(first, second), false);
  first.abort();
  assert.equal(isCurrentLiveFloorRequest(first, first), false);
  assert.ok(isCurrentLiveFloorRequest(second, second));
  assert.equal(isCurrentLiveFloorRequest(second, null), false);
});

test("live-floor manual refresh and polling use one abortable request owner", () => {
  const code = readFileSync("src/components/workspace/workforce-live-floor.tsx", "utf8");
  for (const token of [
    "const activeSnapshot = activeLiveFloorSnapshot(snapshot, scopeKey);",
    "pendingRequest.current?.abort();",
    "signal: controller.signal",
    "if (!isCurrentLiveFloorRequest(controller, pendingRequest.current)) return;",
    "setSnapshot({ scopeKey: requestedScope, data: value as FloorSnapshot });",
    "if (value?.page !== page)",
    "if (document.visibilityState === \"visible\") void load();",
    "return () => { active = false; pendingRequest.current?.abort(); clearInterval(interval); };",
    '{activeSnapshot && <div className="workforce-floor-content">',
  ]) {
    assert.ok(code.includes(token), `missing client guard: ${token}`);
  }
  assert.match(code, /queueMicrotask\(\(\) => \{\s*if \(active\) void load\(\)/);
  assert.ok(!code.includes("void load(controller.signal)"));
  assert.ok(code.includes("Not proof of onsite presence or an absence finding."));
});

test("changing employers remounts live-floor filters, paging and request owner before paint", () => {
  const code = readFileSync("src/components/workspace/workforce-live-floor.tsx", "utf8");
  // A keyed child fully resets local state on employer change. Do not rely on
  // a post-paint effect to briefly retain the previous employer's filters.
  assert.match(code, /return <WorkforceLiveFloorContent key=\{props\.organizationId\} \{\.\.\.props\} \/>/);
  assert.match(code, /function WorkforceLiveFloorContent\(\{ organizationId, onOpenAttendance \}/);
  assert.match(code, /const \[page, setPage\] = useState\(1\)/);
  assert.match(code, /const \[view, setView\] = useState/);
  assert.match(code, /const \[search, setSearch\] = useState\(""/);
  assert.match(code, /return \(\) => \{ active = false; pendingRequest\.current\?\.abort\(\); clearInterval\(interval\); \}/);
  assert.doesNotMatch(code, /useEffect\(\(\) => \{ setPage\(1\); setSearch\(""\); setView\("all"\)/);
});
