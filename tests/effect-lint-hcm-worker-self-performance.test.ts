import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lifecyclePath = "src/components/hcm-employment-lifecycle-worker.tsx";
const performancePath = "src/components/hcm-self-performance.tsx";
const files = [lifecyclePath, performancePath];
const read = (path: string) => readFileSync(path, "utf8");

test("governed lifecycle terms and successor-decision drafts remount for employer and employee", () => {
  const source = read(lifecyclePath);
  assert.match(source, /ScopedHcmEmploymentLifecycleWorker key=\{\`\$\{props\.organizationId\}:\$\{props\.employeeId\}\`\}/);
  assert.ok(source.indexOf("function ScopedHcmEmploymentLifecycleWorker(") < source.indexOf("const [terms, setTerms]"));
  assert.match(source, /const decisionForm = decisionDraft\?\.sourceKey === termKey \? decisionDraft\.value : decisionFormBase/);
  assert.match(source, /activeTerm\?\.id \?\? "none"/);
  assert.match(source, /activeLifecycle\?\.dueDate \?\? serverToday/);
  assert.match(source, /activeTerm\?\.contractEndDate \?\? ""/);
  assert.match(source, /const previous = current\?\.sourceKey === termKey \? current\.value : decisionFormBase/);
});

test("successor-term decision form defaults derive from the latest governed term without effect setters", () => {
  const source = read(lifecyclePath);
  for (const key of [
    "nextEmploymentType: activeTerm?.employmentType || currentEmploymentType || \"Regular\"",
    'nextTermKind: activeTerm?.termKind ?? "regular"',
    'nextEffectiveUntil: activeTerm?.effectiveUntil ?? ""',
    'nextProbationReviewDate: activeTerm?.probationReviewDate ?? ""',
    'nextContractEndDate: activeTerm?.contractEndDate ?? ""',
    'nextProjectName: activeTerm?.projectName ?? ""',
    "proposedSeparationLastDay:",
    "decisionKind: activeTerm.termKind === \"probationary\" ? \"confirm_regular\" : \"continue_current\"",
  ]) assert.ok(source.includes(key), key);
  assert.doesNotMatch(source, /\[activeTerm\?\.id, activeLifecycle\?\.dueDate, serverToday\]/);
  assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1);
  assert.match(source, /setDecisionDraft\(\(current\) => \{/);
});

test("governed term and decision GETs abort and reject retired employer/employee responses", () => {
  const source = read(lifecyclePath);
  assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/);
  assert.match(source, /loadControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(source, /mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
  assert.match(source, /setTerms\(\[\]\);\s*setDecisions\(\[\]\)/);
  assert.equal((source.match(/cache: "no-store", signal: controller\.signal/g) ?? []).length, 2);
  assert.match(source, /if \(!isCurrent\(\)\) return;\s*if \(!termRes\.ok\)/);
  assert.match(source, /if \(isCurrent\(\)\) setLoading\(false\)/);
});

test("governed term loading and authorization errors fail closed before any lifecycle actions are shown", () => {
  const source = read(lifecyclePath);
  assert.match(source, /const \[loadError, setLoadError\] = useState\(""\)/);
  assert.match(source, /setLoading\(true\);\s*setError\(""\);\s*setLoadError\(""\)/);
  assert.match(source, /if \(isCurrent\(\)\) setLoadError\(loadFailure instanceof Error/);
  assert.match(source, /if \(loading \|\| loadError\) return \(/);
  assert.match(source, /Loading governed employment lifecycle/);
  assert.match(source, /className="notice notice-red"/);
  assert.match(source, /onClick=\{\(\) => void load\(\)\}>Retry/);
  assert.ok(source.indexOf("if (loading || loadError) return (") < source.indexOf("No active governed employment terms."));
});

test("governed lifecycle mutations retain explicit four-eyes review, 202 reconciliation and separation handoff", () => {
  const source = read(lifecyclePath);
  for (const key of [
    '"/api/hcm/employment-terms"', '"/api/hcm/employment-term-decisions"',
    "decisionKind: decisionForm.decisionKind",
    "employmentTermId: activeTerm.id", 'body.nextTermKind = decisionForm.nextTermKind',
    'decisionForm.decisionKind === "non_renew"',
    "body.proposedSeparationLastDay = decisionForm.proposedSeparationLastDay",
    "body.separationReason = decisionForm.separationReason",
    "separationHandoffStatus", "Four-eyes approval applies.",
    "Regularization, renewal, conversion, and separation require explicit governed actions.",
    "requires reconciliation", "await onChanged?.()",
  ]) assert.ok(source.includes(key), key);
  assert.match(source, /if \(!mountedRef\.current \|\| readRevision !== loadRevisionRef\.current\) return null/);
  assert.match(source, /if \(payload && mountedRef\.current\) setShowDecisionForm\(false\)/);
  assert.match(source, /if \(mountedRef\.current\) setBusy\(false\)/);
});

test("self-performance read aborts latest request and clears sensitive appraisal state before reauthorizing", () => {
  const source = read(performancePath);
  assert.match(source, /const loadDraft = useCallback\(\(review: Review \| undefined\) => \{/);
  assert.match(source, /\}, \[loadDraft\]\);/);
  assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1);
  assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/);
  assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(source, /const isCurrent = \(\) =>\s*mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
  assert.match(source, /cache: "no-store", signal: controller\.signal/);
  assert.match(source, /setReviews\(\[\]\);\s*setGoals\(\[\]\);\s*setOneOnOnes\(\[\]\);\s*setSharedFeedback\(\[\]\)/);
  assert.match(source, /setSelfScore\("3"\);\s*setReflection\(""\);\s*setItemScores\(\{\}\);\s*setItemComments\(\{\}\)/);
  assert.match(source, /loadRevisionRef\.current \+= 1;\s*mutationRevisionRef\.current \+= 1;\s*loadControllerRef\.current\?\.abort\(\)/);
});

test("self-performance failed read never presents no-review-found as authorized absence", () => {
  const source = read(performancePath);
  assert.match(source, /if \(loadError\) \{/);
  assert.match(source, /onClick=\{\(\) => void load\(\)\}>Retry/);
  assert.match(source, /setLoadError\(message\)/);
  assert.match(source, /setNotice\(message\)/);
  assert.ok(source.indexOf("if (loadError)") < source.indexOf("No performance review has been opened"));
});

test("self-performance late agenda, action-item and assessment submissions cannot write retired UI", () => {
  const source = read(performancePath);
  assert.equal((source.match(/const mutationRevision = \+\+mutationRevisionRef\.current/g) ?? []).length, 3);
  assert.equal((source.match(/const readRevision = loadRevisionRef\.current/g) ?? []).length, 3);
  assert.equal((source.match(/if \(!isCurrentMutation\(\)\) return;/g) ?? []).length, 3);
  assert.match(source, /mutationRevisionRef\.current \+= 1;\s*const review = reviews\.find/);
  assert.match(source, /if \(mountedRef\.current && mutationRevision === mutationRevisionRef\.current\) setAgendaSavingId\(null\)/);
  assert.match(source, /if \(mountedRef\.current && mutationRevision === mutationRevisionRef\.current\) setActionSavingId\(null\)/);
  assert.match(source, /if \(mountedRef\.current && mutationRevision === mutationRevisionRef\.current\) setSaving\(false\)/);
});

test("employee appraisal and 1:1 contracts remain self-only, manager final decision is separate", () => {
  const source = read(performancePath);
  for (const key of [
    'fetch("/api/self/performance"', 'fetch("/api/self/performance/action-items"',
    'method: "PATCH"', 'method: "POST"', 'oneOnOneId: meeting.id',
    "employeeReflection: reflection", "itemScores[item.id]", "itemComments[item.id]",
    'status: "in_progress" | "completed"',
    "Agenda item shared for your upcoming 1:1.",
    "It remains separate from manager-private notes.",
    "final rating remains a separate manager decision.",
  ]) assert.ok(source.includes(key), key);
});

test("retire two lifecycle and one self-appraisal effects; keep repository lint debt monotonically shrinking", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, Record<string, { count: number }>>;
  for (const path of files) assert.equal(manifest[path], undefined, path);
  const warnings = Object.values(manifest).reduce(
    (sum, rules) => sum + (rules["react-hooks/set-state-in-effect"]?.count ?? 0), 0,
  );
  assert.ok(warnings <= 19, "Effect lint warnings exceed 19");
  assert.ok(Object.keys(manifest).length <= 15, "Effect lint file count exceeds 15");
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
