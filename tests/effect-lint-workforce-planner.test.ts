import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  scopedWorkforcePlannerPreview,
  workforcePlannerDraftDefaults,
} from "../src/lib/workforce-planner-view";

const PLANNER = "src/components/workspace/workforce-planner.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("rotation defaults derive from the current catalog, including the empty catalog", () => {
  assert.deepEqual(workforcePlannerDraftDefaults(), {
    patternChoices: ["", "", "", "", "", "", ""],
    overrideMode: "REST",
    assignmentPatternId: "",
  });
  assert.deepEqual(workforcePlannerDraftDefaults(17, 43), {
    patternChoices: ["17", "17", "17", "17", "17", "REST", "REST"],
    overrideMode: "17",
    assignmentPatternId: "43",
  });
  assert.deepEqual(workforcePlannerDraftDefaults(0, 0), {
    patternChoices: ["0", "0", "0", "0", "0", "REST", "REST"],
    overrideMode: "0",
    assignmentPatternId: "0",
  });
});

test("a roster preview is invisible immediately after employer, worker or date changes", () => {
  const key = JSON.stringify([11, 72, "2026-10-16", "2026-10-29"]);
  const fakePreview = { employee: "synthetic Worker A", days: 14 };
  const snapshot = { scopeKey: key, data: fakePreview };
  assert.deepEqual(scopedWorkforcePlannerPreview(snapshot, key), fakePreview);
  for (const staleView of [
    JSON.stringify([12, 72, "2026-10-16", "2026-10-29"]),
    JSON.stringify([11, 73, "2026-10-16", "2026-10-29"]),
    JSON.stringify([11, 72, "2026-10-17", "2026-10-30"]),
  ]) {
    assert.equal(scopedWorkforcePlannerPreview(snapshot, staleView), null);
  }
  assert.equal(scopedWorkforcePlannerPreview(null, key), null);
});

test("the planner remounts across employer, viewer and permission changes and keeps edits in the scoped child", () => {
  const src = read(PLANNER);
  assert.match(src, /WorkforcePlannerContent key=\{JSON\.stringify\(\[/);
  assert.match(src, /props\.data\.selectedOrganization\.id,/);
  assert.match(src, /props\.data\.user\?\.id \?\? null,/);
  assert.match(src, /props\.data\.access\?\.role \?\? null,/);
  assert.match(src, /props\.data\.access\?\.companyWide === true,/);
  assert.doesNotMatch(src, /WorkforcePlannerContent key=\{props\.data\.selectedOrganization\.id\}/);
  assert.ok(src.indexOf("function WorkforcePlannerContent(") < src.indexOf("const [catalog, setCatalog]"));
  assert.match(src, /const patternChoices = patternChoicesDraft \?\? defaults\.patternChoices/);
  assert.match(src, /const overrideMode = overrideModeDraft \?\? defaults\.overrideMode/);
  assert.match(src, /const assignmentPatternId = assignmentPatternIdDraft \?\? defaults\.assignmentPatternId/);
  assert.match(src, /setPatternChoicesDraft\(\(current\) => \(current \?\? patternChoices\)\.map/);
  assert.match(src, /setPatternChoicesDraft\(result\.choices\)/);
  assert.match(src, /setAssignmentPatternIdDraft\(null\)/);
  assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*if \(!catalog\?\.shifts\.length/);
  assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*if \(!assignmentPatternId/);
});

test("catalog and roster GETs are deferred, abortable and last-request-owned", () => {
  const src = read(PLANNER);
  assert.match(src, /const loadCatalog = useCallback\(async \(signal\?: AbortSignal\) =>/);
  assert.match(src, /const loadPreview = useCallback\(async \(signal\?: AbortSignal\) =>/);
  assert.match(src, /const requestId = \+\+catalogRequest\.current/);
  assert.match(src, /const requestId = \+\+previewRequest\.current/);
  assert.match(src, /requestId === catalogRequest\.current/);
  assert.match(src, /requestId === previewRequest\.current/);
  assert.match(src, /const previewScopeKey = JSON\.stringify\(\[organizationId, employeeId, rangeStart, rangeEnd\]\)/);
  assert.match(src, /const scopeKey = JSON\.stringify\(\[organizationId, employeeId, rangeStart, rangeEnd\]\)/);
  assert.match(src, /setPreviewSnapshot\(\{ scopeKey, data: payload as Preview \}\)/);
  assert.match(src, /\}, \[employeeId, organizationId, rangeEnd, rangeStart, notify\]\);/);
  assert.doesNotMatch(src, /\}, \[employeeId, organizationId, rangeEnd, rangeStart, notify, previewScopeKey\]\);/);
  assert.equal((src.match(/const controller = new AbortController\(\)/g) ?? []).length, 2);
  assert.equal((src.match(/queueMicrotask\(\(\) => \{/g) ?? []).length, 2);
  assert.equal((src.match(/return \(\) => controller\.abort\(\)/g) ?? []).length, 2);
  assert.match(src, /catalogRequest\.current \+= 1/);
  assert.match(src, /previewRequest\.current \+= 1/);
  assert.equal((src.match(/\s+signal,\s*\}\);/g) ?? []).length, 2);
});

test("existing secured schedule actions, role boundaries and preview date range remain", () => {
  const src = read(PLANNER);
  assert.match(src, /fetch\("\/api\/workforce\/schedules", \{/);
  assert.match(src, /method: "POST"/);
  for (const action of ["create_shift", "create_pattern", "assign_schedule", "create_override"]) {
    assert.ok(src.includes('"' + action + '"'));
  }
  assert.match(src, /startDate: rangeStart/);
  assert.match(src, /endDate: rangeEnd/);
  assert.match(src, /data\.access\?\.role === "manager"/);
  assert.match(src, /process\.env\.NEXT_PUBLIC_WFM_BULK_PUBLISH_UI_ENABLED === "true"/);
  const suppressions = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(suppressions[PLANNER], undefined);
});
