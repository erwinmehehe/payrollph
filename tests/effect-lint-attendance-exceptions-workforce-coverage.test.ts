import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const attendancePath = "src/components/workspace/attendance-exceptions-panel.tsx";
const coveragePath = "src/components/workspace/workforce-coverage-panel.tsx";
const read = (path: string) => readFileSync(path, "utf8");

test("attendance exception case and resolution drafts remount for every new employer", () => {
  const source = read(attendancePath);
  assert.match(source, /ScopedAttendanceExceptionsPanel key=\{props\.organizationId\}/);
  assert.ok(source.indexOf("function ScopedAttendanceExceptionsPanel(") < source.indexOf("const [resolutionDrafts, setResolutionDrafts]"));
  assert.match(source, /setResolutionDrafts\(\{\}\);\s*setActionBusyId\(null\)/);
  assert.match(source, /const \[resolutionDrafts, setResolutionDrafts\] = useState<Record<number, string>>\(\{\}\)/);
});

test("attendance effect retires initial Strict Mode work and cancels any former scope's requests", () => {
  const source = read(attendancePath);
  assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1);
  assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/);
  assert.match(source, /retired = true;\s*mountedRef\.current = false;\s*loadRevisionRef\.current \+= 1;\s*mutationRevisionRef\.current \+= 1;\s*activeRequest\.current\?\.abort\(\)/);
  assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(source, /mountedRef\.current && !controller\.signal\.aborted\s*&& activeRequest\.current === controller && revision === loadRevisionRef\.current/);
  assert.match(source, /if \(!isCurrent\(\)\) return;/);
  assert.match(source, /if \(isCurrent\(\)\) \{\s*activeRequest\.current = null;\s*setLoading\(false\)/);
});

test("attendance separate analysis and operational SLA services keep partial-failure behavior", () => {
  const source = read(attendancePath);
  assert.match(source, /Promise\.allSettled\(\[/);
  const verified = read("src/lib/attendance-exception-read.ts");
  assert.match(source, /readVerifiedAttendanceAnalysis\(organizationId, startDate, endDate, fetch, controller\.signal\)/);
  assert.match(source, /readVerifiedAttendanceOperations\(organizationId, startDate, endDate, fetch, controller\.signal\)/);
  assert.match(verified, /fetchVerified\("attendance-exceptions",org,start,end,parseAttendanceAnalysisRead,fetcher,signal\)/);
  assert.match(verified, /fetchVerified\("attendance-exception-events",org,start,end,parseAttendanceOperationsRead,fetcher,signal\)/);
  assert.match(verified, /fetcher\("\/api\/workforce\/"\+path\+"\?"\+search\.toString\(\),\{cache:"no-store",signal\}\)/);
  assert.match(verified, /if\(!verified\)throw Error\(/, "Unverified attendance evidence must fail closed");
  assert.match(source, /if \(analysis\.status === "fulfilled"\)/);
  assert.match(source, /if \(events\.status === "fulfilled"\)/);
  assert.match(source, /Attendance exception analysis unavailable/);
  assert.match(source, /Exception ownership unavailable/);
  assert.match(source, /Your session or workspace permissions need attention/);
});

test("late attendance owner and resolution writes cannot update another employer or date range", () => {
  const source = read(attendancePath);
  assert.match(source, /const mutationRevision = \+\+mutationRevisionRef\.current/);
  assert.match(source, /const readRevision = loadRevisionRef\.current/);
  assert.match(source, /const isCurrentMutation = \(\) =>\s*mountedRef\.current && mutationRevision === mutationRevisionRef\.current\s*&& readRevision === loadRevisionRef\.current/);
  assert.match(source, /const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!isCurrentMutation\(\)\) return;/);
  assert.match(source, /if \(isCurrentMutation\(\)\) \{\s*notify\(error instanceof Error/);
  assert.match(source, /if \(mountedRef\.current && mutationRevision === mutationRevisionRef\.current\) setActionBusyId\(null\)/);
  for (const key of [
    '"assign_owner" | "record_resolution"',
    "setResolutionDrafts((current)",
    'action === "record_resolution"',
    "Attendance exception resolution evidence recorded.",
    "AttendanceLockControl",
  ]) assert.ok(source.includes(key), key);
});

test("coverage isolation is keyed by legal employer, legal entity, signed-in user and permissions", () => {
  const source = read(coveragePath);
  for (const key of [
    "props.data.selectedOrganization.id",
    'props.data.multiEntity?.legalEntityId ?? "all"',
    'props.data.user?.id ?? "anonymous"',
    'props.data.access?.role ?? "none"',
    'props.data.access?.orgUnitName ?? "all"',
    "props.data.access?.companyWide === true",
    "props.canManage",
    "<ScopedWorkforceCoveragePanel key={scope}",
  ]) assert.ok(source.includes(key), key);
  assert.ok(source.indexOf("function ScopedWorkforceCoveragePanel(") < source.indexOf("const [payload, setPayload]"));
});

test("coverage and governed approval reads cannot rehydrate obsolete employee, costs or review evidence", () => {
  const source = read(coveragePath);
  assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1);
  assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/);
  assert.match(source, /loadControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(source, /mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
  assert.match(source, /setPayload\(null\);\s*setReviewChains\(\[\]\);\s*setReviewByClaimId\(\{\}\)/);
  assert.equal((source.match(/cache: "no-store", signal: controller\.signal/g) ?? []).length, 2);
  assert.match(source, /const reviewResponse = await fetch\(/);
  const guardedReview = source.indexOf("if (!isCurrent()) return;", source.indexOf("const reviewResponse = await fetch("));
  const release = source.indexOf("setPayload(body as Payload)");
  assert.ok(guardedReview > 0 && release > guardedReview, "payload may publish only after governed handoff ownership check");
});

test("coverage selection defaults are derived from the current authorized catalog, never effect state", () => {
  const source = read(coveragePath);
  assert.match(source, /const selectedRequirementWorksiteId = \(payload\?\.worksites \?\? \[\]\)\.some\(/);
  assert.match(source, /const selectedRequirementShiftId = \(payload\?\.shifts \?\? \[\]\)\.some\(/);
  assert.match(source, /String\(payload\?\.worksites\[0\]\?\.id \?\? ""\)/);
  assert.match(source, /String\(payload\?\.shifts\[0\]\?\.id \?\? ""\)/);
  assert.match(source, /if \(!selectedRequirementWorksiteId \|\| !selectedRequirementShiftId \|\| !requirementDate\)/);
  assert.match(source, /worksiteId: Number\(selectedRequirementWorksiteId\)/);
  assert.match(source, /shiftDefinitionId: Number\(selectedRequirementShiftId\)/);
  assert.match(source, /value=\{selectedRequirementWorksiteId\}/);
  assert.match(source, /value=\{selectedRequirementShiftId\}/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*if \(!requirementWorksiteId/);
});

test("failed coverage fetch fails closed instead of claiming no staffing gaps or authorizing edits", () => {
  const source = read(coveragePath);
  assert.match(source, /setLoadError\(message\)/);
  assert.match(source, /if \(!payload && \(loading \|\| loadError\)\) return \(/);
  assert.match(source, /Loading coverage planning/);
  assert.match(source, /className="notice notice-red"/);
  assert.match(source, /onClick=\{\(\) => void load\(\)\}>Retry/);
  assert.match(source, /setLoading\(true\);\s*setLoadError\(""\);\s*setPayload\(null\)/);
});

test("stale coverage mutations and human-approval handoffs cannot notify or update a new scope", () => {
  const source = read(coveragePath);
  assert.match(source, /const mutationRevision = \+\+mutationRevisionRef\.current/);
  assert.match(source, /const isCurrentMutation = \(\) =>\s*mountedRef\.current && mutationRevision === mutationRevisionRef\.current\s*&& readRevision === loadRevisionRef\.current/);
  assert.match(source, /if \(!isCurrentMutation\(\)\) return false;/);
  assert.match(source, /const revision = \+\+reviewMutationRevisionRef\.current/);
  assert.match(source, /const isCurrentReview = \(\) =>\s*mountedRef\.current && revision === reviewMutationRevisionRef\.current\s*&& readRevision === loadRevisionRef\.current/);
  assert.match(source, /if \(!isCurrentReview\(\)\) return;/);
  assert.match(source, /if \(isCurrentReview\(\)\) notify\(error instanceof Error/);
  assert.match(source, /reviewChains\.some\(\(chain\) => chain\.code === reviewChainCode\)/);
  assert.match(source, /chainCode: selectedReviewChainCode/);
});

test("coverage manual approval, no automatic roster or payroll changes, and privacy boundary remain intact", () => {
  const source = read(coveragePath);
  for (const key of [
    '"create_requirement"', '"create_availability"', '"create_open_shift"',
    '"decide_claim"', '"stage_recovery_plan"', '"wfm_roster_claim_review"',
    "Human approval requested for claim #",
    "planSmartRecoveryDraft",
    "previewWorkforceRecovery",
    "labor.costVisible",
    "Labor-cost variance is restricted.",
    "canManage && data.access?.companyWide === true",
    "Review-first automation.",
    "Staging creates pending claims only, not a published roster.",
  ]) assert.ok(source.includes(key), key);
});

test("only three React effect warnings across two files are retired; debt cannot regress", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, Record<string, { count: number }>>;
  assert.equal(manifest[attendancePath], undefined);
  assert.equal(manifest[coveragePath], undefined);
  const count = Object.values(manifest).reduce(
    (sum, rules) => sum + (rules["react-hooks/set-state-in-effect"]?.count ?? 0), 0,
  );
  assert.ok(count <= 25, "React effect suppression debt must not exceed 25");
  assert.ok(Object.keys(manifest).length <= 19, "React effect suppressed-file debt must not exceed 19");
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
