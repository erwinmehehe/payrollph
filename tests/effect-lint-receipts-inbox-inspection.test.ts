import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const RECEIPTS = "src/components/employee-schedule-receipts.tsx";
const INBOX = "src/components/hcm-business-process-inbox.tsx";
const DRILL = "src/components/workspace/labor-inspection-drill-panel.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("employee schedule receipts defer initial read and preserve request/write teardown", () => {
  const source = read(RECEIPTS);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(!cancelled\) void load\(\)/);
  assert.match(source, /return \(\) => \{\s*cancelled = true;\s*generation\.current\+\+;/);
  assert.match(source, /read\.current\?\.abort\(\)/);
  assert.match(source, /write\.current\?\.abort\(\)/);
  assert.match(source, /request !== generation\.current/);
  assert.match(source, /method: "POST"/);
});

test("HCM business inbox resets tenant-private state and invalidates late reads", () => {
  const source = read(INBOX);
  assert.match(source, /HcmBusinessProcessInboxContent key=\{props\.organizationId\}/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(!cancelled\) void load\(\)/);
  assert.match(source, /return \(\) => \{\s*cancelled = true;\s*requestSequence\.current \+= 1;/);
  assert.match(source, /if \(requestId !== requestSequence\.current\) return/);
  assert.match(source, /makerBlocked/);
});

test("inspection drill history remounts by employer and cancels effect-owned GET", () => {
  const source = read(DRILL);
  assert.match(source, /LaborInspectionDrillPanelContent key=\{props\.organizationId\}/);
  assert.match(source, /const load = useCallback\(async \(signal\?: AbortSignal\) => \{/);
  assert.match(source, /\{ cache: "no-store", signal \}/);
  assert.match(source, /queueMicrotask\(\(\) => \{\s*if \(!controller\.signal\.aborted\) void load\(controller\.signal\)/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /if \(signal\?\.aborted\) return/);
  assert.match(source, /method: "POST"/);
});

test("the three resolved effect suppressions are absent without relaxing other rules", () => {
  const suppressions = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  for (const path of [RECEIPTS, INBOX, DRILL]) assert.equal(suppressions[path], undefined);
});
