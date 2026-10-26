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
  // Mount starts after effect setup, not during render or synchronous effect work.
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(active\) void load\(\)/);
  assert.match(source, /return \(\) => \{\s*active = false/);
  // A refresh revokes previous private evidence and aborts old requests.
  assert.match(source, /directoryController\.current\?\.abort\(\)/);
  assert.match(source, /comparisonController\.current\?\.abort\(\)/);
  assert.match(source, /directoryRevision\.current \+= 1/);
  assert.match(source, /comparisonRevision\.current \+= 1/);
  assert.match(source, /setDirectoryReady\(false\)/);
  assert.match(source, /setEmployees\(\[\]\)/);
  assert.match(source, /setRequisitions\(\[\]\)/);
  assert.match(source, /setResult\(null\)/);
  // Even a transport that ignores abort cannot restore stale private data.
  assert.match(source, /directoryRevision\.current === revision/);
  assert.match(source, /directoryRevision\.current === directoryAtStart/);
  assert.match(source, /readTalentDirectory\(organizationId, fetch, controller\.signal\)/);
  assert.match(source, /readTalentComparison\(/);
  assert.ok(source.includes('onClick={() => { void load(); }}'));
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
