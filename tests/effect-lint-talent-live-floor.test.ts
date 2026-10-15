import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const TALENT = "src/components/talent-continuity-panel.tsx";
const FLOOR = "src/components/workspace/workforce-live-floor.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("private internal role comparisons remount by employer and load asynchronously", () => {
  const source = read(TALENT);
  assert.match(source, /TalentContinuityContent key=\{props\.organizationId\}/);
  assert.match(source, /const \[loading, setLoading\] = useState\(true\)/);
  assert.doesNotMatch(source, /const load = useCallback\(async \(signal\?: AbortSignal\) => \{\s*setLoading\(true\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(!controller\.signal\.aborted\) void load\(controller\.signal\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.ok(source.includes('onClick={() => { setLoading(true); setError(""); setResult(null); void load(); }}'));
  assert.match(source, /if \(signal\?\.aborted\) return/);
});

test("live floor starts loading per mount, page or click; polling is read-only and abortable", () => {
  const source = read(FLOOR);
  assert.match(source, /WorkforceLiveFloorContent key=\{props\.organizationId\}/);
  assert.match(source, /const \[loading, setLoading\] = useState\(true\)/);
  assert.doesNotMatch(source, /const requestedScope = liveFloorScopeKey\(organizationId, page\);\s*setLoading\(true\)/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(active\) void load\(\)/);
  assert.match(source, /return \(\) => \{ active = false; pendingRequest\.current\?\.abort\(\)/);
  assert.match(source, /if \(document\.visibilityState === "visible"\) void load\(\)/);
  assert.match(source, /pendingRequest\.current\?\.abort\(\)/);
  assert.match(source, /setSnapshot\(\{ scopeKey: requestedScope, data: value as FloorSnapshot \}\)/);
  assert.ok(source.includes('onClick={() => { setLoading(true); setError(null); void load(); }}'));
  assert.ok(source.includes('onClick={() => { setLoading(true); setPage(p => p + 1); }}'));
});

test("only resolved per-file React effect allowances are removed", () => {
  const baseline = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(baseline[TALENT], undefined);
  assert.equal(baseline[FLOOR], undefined);
});
