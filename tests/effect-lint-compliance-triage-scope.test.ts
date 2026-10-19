import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const casesPath = "src/components/workspace/statutory-contribution-issue-cases-panel.tsx";
const attendancePath = "src/components/workspace/attendance-corrections-panel.tsx";
const remittancePath = "src/components/workspace/statutory-remittance-panel.tsx";
const paths = [casesPath, attendancePath, remittancePath];
const read = (path: string) => readFileSync(path, "utf8");

test("employee contribution cases and remittance drafts remount by employer and legal entity", () => {
  const cases = read(casesPath);
  const remit = read(remittancePath);
  assert.match(cases, /props\.organizationId \+ ":" \+ String\(props\.legalEntityId \?\? "all"\)/);
  assert.match(cases, /<ScopedStatutoryContributionIssueCasesPanel key=\{scope\}/);
  assert.match(remit, /\[props\.organizationId, props\.legalEntityId \?\? "all", props\.defaultMonth\]\.join\(":"\)/);
  assert.match(remit, /<ScopedStatutoryRemittancePanel key=\{scope\}/);
  assert.ok(cases.indexOf("function ScopedStatutoryContributionIssueCasesPanel(") < cases.indexOf("const [cases, setCases]"));
  assert.ok(remit.indexOf("function ScopedStatutoryRemittancePanel(") < remit.indexOf("const [paymentReference, setPaymentReference]"));
});

test("attendance correction approval drafts reset on employer, user, or reviewer-permission change", () => {
  const source = read(attendancePath);
  assert.match(source, /\[props\.organizationId, props\.currentUserId \?\? "none", props\.canManage, props\.canDecide\]\.join\(":"\)/);
  assert.match(source, /<ScopedAttendanceCorrectionsPanel key=\{scope\}/);
  assert.ok(source.indexOf("function ScopedAttendanceCorrectionsPanel(") < source.indexOf("const [selectedPunchId, setSelectedPunchId]"));
  assert.match(source, /const \[timeIn, setTimeIn\] = useState\(""\)/);
  assert.match(source, /const \[reason, setReason\] = useState\(""\)/);
});

test("all three initial scoped reads defer synchronous effect state work and abort retired setups", () => {
  for (const path of paths) {
    const source = read(path);
    assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1, path);
    assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/, path);
    assert.match(source, /retired = true;\s*mountedRef\.current = false;\s*loadRevisionRef\.current \+= 1;\s*loadControllerRef\.current\?\.abort\(\)/, path);
    assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void load\(\)/, path);
  }
});

test("all three GETs hide stale private data, cancel prior requests, and accept only the newest scoped response", () => {
  const [cases, attendance, remit] = paths.map(read);
  for (const source of [cases, remit]) {
    assert.match(source, /loadControllerRef\.current\?\.abort\(\)/);
    assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
    assert.match(source, /const isCurrent = \(\) =>\s*mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
    assert.match(source, /\{ cache: "no-store", signal: controller\.signal \}/);
    assert.match(source, /if \(!isCurrent\(\)\) return/);
    assert.match(source, /if \(isCurrent\(\)\) setLoading\(false\)/);
  }
  // Attendance now moves the fetch/response contract into a pure helper.
  // Validate the component's scope revision guards and the helper's actual request.
  const attendanceRead = read("src/lib/workforce-attendance-corrections-read.ts");
  assert.match(attendance, /loadControllerRef\.current\?\.abort\(\)/);
  assert.match(attendance, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(attendance, /const isCurrent = \(\) =>\s*mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
  assert.match(attendance, /readVerifiedAttendanceCorrections\(organizationId, fetch, controller\.signal\)/);
  assert.match(attendanceRead, /cache: "no-store", signal/);
  assert.match(attendance, /if \(!isCurrent\(\)\) return/);
  assert.match(attendance, /if \(isCurrent\(\)\) setLoading\(false\)/);
  assert.match(attendance, /const queueVerified = !loading && !readError/);
  assert.match(attendance, /queueVerified && corrections\.length === 0/);
  assert.match(cases, /setCases\(\[\]\);\s*setLoadError\(""\)/);
  assert.match(attendance, /setCorrections\(\[\]\)/);
  assert.match(remit, /setBatches\(\[\]\);\s*setMembers\(\[\]\);\s*setCoverageGaps\(\[\]\)/);
});

test("failed contribution-case loads cannot appear as clean; update and correction evidence remains gated", () => {
  const source = read(casesPath);
  assert.match(source, /loadError \? \(\s*<div className="notice notice-red">/);
  assert.match(source, /setLoadError\(message\)/);
  assert.match(source, /active\.length === 0 \? \(/);
  const error = source.indexOf("loadError ? (");
  const empty = source.indexOf("active.length === 0 ? (");
  assert.ok(error >= 0 && empty > error, "Error state must precede the no-cases claim");
  for (const key of [
    'action: "request_missing_member_correction"',
    '"start_review" | "add_update" | "resolve"',
    "contributionCaseResolutionPolicyMessage",
    "/api/compliance/contribution-issues/evidence?organizationId=",
    "window.dispatchEvent(new Event(\"statutory-remittance-changed\"))",
  ]) assert.ok(source.includes(key), key);
  assert.match(source, /const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return false;/);
  assert.match(source, /if \(!mountedRef\.current\) return;\s*if \(!response\.ok\) throw new Error\(body\.error \?\? "Missing-member correction/);
  assert.match(source, /if \(mountedRef\.current\) setBusy\(null\)/);
});

test("attendance decisions keep independent reviewer and payroll invalidation protections", () => {
  const source = read(attendancePath);
  for (const key of [
    'action: "create_request"',
    'action: "decide_request"',
    "row.requestedByUserId !== currentUserId",
    "canDecide &&",
    "canManage &&",
    "proposedTimeIn: phIso(timeIn)",
    "proposedTimeOut: phIso(timeOut)",
    "window.location.reload()",
    "Original punches stay in the audit snapshot.",
  ]) assert.ok(source.includes(key), key);
  assert.equal(
    (source.match(/const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return;/g) ?? []).length,
    2,
  );
  assert.equal((source.match(/if \(mountedRef\.current\) setSaving\(false\)/g) ?? []).length, 2);
});

test("remittance read errors disable financial controls instead of implying zero liability", () => {
  const source = read(remittancePath);
  assert.match(source, /const load = useCallback\(async \(\): Promise<boolean> => \{/);
  assert.match(source, /setLoading\(true\);\s*setLoadError\(""\)/);
  assert.match(source, /if \(loading\) return <div className="empty-state">/);
  assert.match(source, /if \(loadError\) return \(/);
  assert.match(source, /const refreshed = await load\(\);\s*if \(!mountedRef\.current \|\| !refreshed\) return false;/);
  assert.match(source, /setLoadError\(message\)/);
  assert.match(source, /notify\(message, "err"\)/);
});

test("remittance payment, posting, exceptional-evidence writes remain scoped and audit-first", () => {
  const source = read(remittancePath);
  for (const key of [
    '"create_batch"', '"record_payment"', '"confirm_member_posting"', '"mark_member_exception"',
    "body: JSON.stringify({ organizationId, legalEntityId: legalEntityId ?? undefined, action, ...payload })",
    "StatutoryPostingImport", "StatutoryPaymentProof",
    "paymentReference", "agencyReceiptReference", "paymentVarianceNote",
    "postingReference", "exceptionNote",
  ]) assert.ok(source.includes(key), key);
  assert.match(source, /const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return false;/);
  assert.match(source, /if \(mountedRef\.current\) setBusy\(null\)/);
  // The posting-import child requires a Promise<void> completion callback.
  assert.match(source, /onImported=\{async \(\) => \{ await load\(\); \}\}/);
  assert.match(source, /window\.dispatchEvent\(new Event\("statutory-remittance-changed"\)\)/);
  assert.ok(source.includes("A filing acceptance is not treated as proof of payment or employee posting."));
});

test("retire only the three scoped React effect exemptions; keep monotonic debt and global lint gate", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, Record<string, { count: number }>>;
  for (const path of paths) assert.equal(manifest[path], undefined, path);
  const total = Object.values(manifest).reduce((n, rules) => n + (rules["react-hooks/set-state-in-effect"]?.count ?? 0), 0);
  assert.ok(total <= 28, "React effect debt must not rise above 28");
  assert.ok(Object.keys(manifest).length <= 21, "React effect file debt must not rise above 21");
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
