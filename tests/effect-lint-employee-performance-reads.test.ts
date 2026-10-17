import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = {
  documents: "src/components/employee-documents-panel.tsx",
  continuity: "src/components/performance-continuity-panel.tsx",
  followThrough: "src/components/performance-follow-through-panel.tsx",
} as const;

const read = (path: string) => readFileSync(path, "utf8");

test("employee document acknowledgements, file picks, and all performance drafts are employer scoped", () => {
  const documents = read(files.documents);
  const continuity = read(files.continuity);
  const followThrough = read(files.followThrough);
  assert.match(documents, /EmployeeDocumentsContent key=\{props\.organizationId\}/);
  assert.match(continuity, /PerformanceContinuityContent key=\{props\.organizationId\}/);
  assert.match(followThrough, /PerformanceFollowThroughContent key=\{props\.organizationId \+ ":" \+ String\(props\.canGovern\)\}/);

  for (const [source, name] of [
    [documents, "EmployeeDocumentsContent"],
    [continuity, "PerformanceContinuityContent"],
    [followThrough, "PerformanceFollowThroughContent"],
  ]) {
    assert.ok(source.indexOf("function " + name + "(") < source.indexOf("const ["), name);
  }
  assert.match(documents, /const \[confirmed, setConfirmed\] = useState<Set<number>>/);
  assert.match(documents, /const \[file, setFile\] = useState<File \| null>/);
  assert.match(continuity, /const \[privateNotes, setPrivateNotes\]/);
  assert.match(followThrough, /const \[sealNotes, setSealNotes\]/);
});

test("all three initial GETs defer effect-phase state work and invalidate Strict Mode retired setups", () => {
  for (const path of Object.values(files)) {
    const source = read(path);
    assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/);
    assert.match(source, /retired = true;\s*mountedRef\.current = false;\s*requestRevisionRef\.current \+= 1;\s*requestControllerRef\.current\?\.abort\(\)/);
    assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1, path);
    assert.doesNotMatch(source, /useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/);
  }
});

test("refresh and initial loads share a single abortable request owner", () => {
  for (const path of Object.values(files)) {
    const source = read(path);
    assert.match(source, /const revision = \+\+requestRevisionRef\.current/);
    assert.match(source, /const isCurrent = \(\) =>\s*mountedRef\.current && !controller\.signal\.aborted && revision === requestRevisionRef\.current/);
    assert.match(source, /requestControllerRef\.current\?\.abort\(\)/);
    assert.match(source, /signal: controller\.signal/);
    assert.match(source, /if \(!isCurrent\(\)\) return;/);
    assert.match(source, /if \(!mountedRef\.current\) return;/);
  }
});

test("two-endpoint performance reads never mix employer generations or previous governance access", () => {
  const continuity = read(files.continuity);
  const followThrough = read(files.followThrough);
  for (const source of [continuity, followThrough]) {
    assert.match(source, /const \[.+\] = await Promise\.all\(\[/);
    assert.match(source, /if \(!isCurrent\(\)\) return;\s*if \(!/);
    assert.match(source, /if \(mountedRef\.current\) setNotice\(message\)/);
  }
  assert.match(continuity, /meeting\.privateManagerNotes \?\? ""/);
  assert.match(continuity, /meeting\.sharedSummary \?\? ""/);
  assert.match(continuity, /signal: controller\.signal/);
  assert.match(followThrough, /canGovern\s*\?\s*fetch\("\/api\/performance\/follow-through-governance/);
  assert.match(followThrough, /if \(governancePayload\) \{\s*setGovernance\(governancePayload\)/);
  assert.match(followThrough, /canGovern, announce\]/);
});

test("retired policy acknowledgements, document uploads and performance writes cannot mutate current UI", () => {
  const documents = read(files.documents);
  const continuity = read(files.continuity);
  const followThrough = read(files.followThrough);
  const guardedResponse = /const payload = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return;/g;
  assert.equal((documents.match(guardedResponse) ?? []).length, 2);
  assert.equal((continuity.match(guardedResponse) ?? []).length, 5);
  assert.equal((followThrough.match(guardedResponse) ?? []).length, 7);
  assert.match(documents, /if \(mountedRef\.current\) setError\(ackError/);
  assert.match(documents, /if \(mountedRef\.current\) setError\(uploadError/);
  assert.equal((documents.match(/if \(mountedRef\.current\) setBusy\(false\)/g) ?? []).length, 2);
  assert.match(continuity, /await load\(\);\s*announce\("1:1 scheduled/);
  assert.match(followThrough, /await load\(\);\s*announce\("Performance evidence retention policy/);
});

test("security-sensitive policy version, document, 1:1 and evidence write contracts remain unchanged", () => {
  const documents = read(files.documents);
  const continuity = read(files.continuity);
  const followThrough = read(files.followThrough);
  for (const required of ['action: "acknowledge-policy"', "assignmentId: assignment.assignmentId", 'form.set("organizationId"', 'form.set("requirementId"', "EmployeeVaultProfilePanel"]) {
    assert.ok(documents.includes(required), "Missing document control " + required);
  }
  for (const required of ['entityType: "one_on_one"', 'entityType: "feedback"', 'privateManagerNotes:', 'sharedSummary:', 'visibility: actionForm.ownerKind === "employee"']) {
    assert.ok(continuity.includes(required), "Missing 1:1 governance control " + required);
  }
  for (const required of ['entityType: "plan"', 'entityType: "milestone"', 'action: "action_reminder_policy"', 'action: "evidence_policy"', '"seal_cycle"', '"legal_hold"', '"amend_seal"']) {
    assert.ok(followThrough.includes(required), "Missing evidence or development control " + required);
  }
});

test("exactly three old per-file set-state-in-effect allowances disappear without global rule relaxation", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, Record<string, { count: number }>>;
  for (const path of Object.values(files)) assert.equal(manifest[path], undefined, path);
  const count = Object.values(manifest).reduce((total, rules) => total + (rules["react-hooks/set-state-in-effect"]?.count ?? 0), 0);
  assert.equal(count, 37);
  assert.equal(Object.keys(manifest).length, 30);
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
