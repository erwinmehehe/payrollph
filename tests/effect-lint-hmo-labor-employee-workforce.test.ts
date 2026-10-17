import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hmoPath = "src/components/hmo-benefits-panel.tsx";
const laborPath = "src/components/workspace/labor-inspection-readiness-panel.tsx";
const employeePath = "src/components/employee-workforce-panel.tsx";
const files = [hmoPath, laborPath, employeePath];
const read = (path: string) => readFileSync(path, "utf8");

test("HMO enrolment review, deductions and inspection closeout remount on employer switch", () => {
  const hmo = read(hmoPath);
  const labor = read(laborPath);
  assert.match(hmo, /ScopedHmoBenefitsPanel key=\{props\.organizationId\}/);
  assert.match(labor, /ScopedLaborInspectionReadinessPanel key=\{props\.organizationId\}/);
  assert.ok(hmo.indexOf("function ScopedHmoBenefitsPanel(") < hmo.indexOf("const [reviewedKey, setReviewedKey]"));
  assert.ok(labor.indexOf("function ScopedLaborInspectionReadinessPanel(") < labor.indexOf("const [closingKey, setClosingKey]"));
  assert.match(hmo, /const \[reviewedKey, setReviewedKey\] = useState<string \| null>\(null\)/);
  assert.match(labor, /const \[closeReference, setCloseReference\] = useState\(""\)/);
});

test("all three effect reads defer mount fetch and cancel Strict Mode's retired setup", () => {
  for (const path of files) {
    const source = read(path);
    assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/, path);
    assert.match(source, /retired = true;/, path);
    assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1, path);
    assert.doesNotMatch(source, /useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/);
  }
});

test("HMO data fetch is abortable, last-generation-owned, and invalidates previous financial display and review", () => {
  const source = read(hmoPath);
  assert.match(source, /loadControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(source, /const isCurrent = \(\) =>\s*mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
  assert.match(source, /cache: "no-store", signal: controller\.signal/);
  assert.match(source, /setData\(null\);\s*setReviewedKey\(null\)/);
  assert.match(source, /if \(!isCurrent\(\)\) return;\s*if \(!response\.ok\)/);
  assert.match(source, /if \(isCurrent\(\)\) setLoading\(false\)/);
  assert.match(source, /loadRevisionRef\.current \+= 1/);
  assert.match(source, /HMO administration unavailable\./);
});

test("HMO payroll-linked enrollment writes and explicit administrator review remain unchanged", () => {
  const source = read(hmoPath);
  const guardedResponse = /const payload = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return;/g;
  assert.equal((source.match(guardedResponse) ?? []).length, 5);
  for (const key of [
    '"create_plan"', '"add_dependent"', '"update_dependent"', '"update_enrollment"',
    'fetch("/api/benefits",', 'monthlyContribution: Number(plan?.employeeShare ?? 0)',
    "benefitEnrollmentReviewConfirmed(reviewedKey, reviewKey)",
    "if (enhancedEnrollment && !reviewConfirmed)",
    "setReviewedKey(null)",
    "formElement.reset()",
  ]) assert.ok(source.includes(key), key);
  assert.match(source, /const announce = useCallback\(\(message: string\) => \{\s*if \(mountedRef\.current\) setNotice\(message\)/);
});

test("inspection refresh abandons revoked findings and ongoing sensitive evidence-pack exports", () => {
  const source = read(laborPath);
  assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
  assert.match(source, /mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
  assert.match(source, /cache: "no-store", signal: controller\.signal/);
  assert.match(source, /exportRevisionRef\.current \+= 1;\s*exportControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /setPayload\(null\);\s*setLoadError\(""\)/);
  assert.match(source, /if \(!isCurrent\(\)\) return;/);
  assert.match(source, /loadRevisionRef\.current \+= 1/);
});

test("old inspection evidence can never download after an employer switch, unmount or refresh", () => {
  const source = read(laborPath);
  assert.match(source, /const revision = \+\+exportRevisionRef\.current/);
  assert.match(source, /const isCurrentExport = \(\) =>\s*mountedRef\.current && !controller\.signal\.aborted && revision === exportRevisionRef\.current/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /const blob = await response\.blob\(\);[\s\S]*?if \(!isCurrentExport\(\)\) return;/);
  const blobIndex = source.indexOf("const blob = await response.blob()");
  const guardIndex = source.indexOf("if (!isCurrentExport()) return;", blobIndex);
  const clickIndex = source.indexOf("anchor.click()", blobIndex);
  assert.ok(blobIndex > 0 && guardIndex > blobIndex && clickIndex > guardIndex, "stale blob may not click a download");
  assert.match(source, /URL\.revokeObjectURL\(url\)/);
  assert.match(source, /if \(isCurrentExport\(\)\) setBusy\(null\)/);
  assert.match(source, /x-payrollph-evidence-sha256/);
});

test("inspection owner/acknowledge/close mutations keep employer constraints and discard late UI completions", () => {
  const source = read(laborPath);
  assert.match(source, /const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return;/);
  assert.match(source, /if \(mountedRef\.current\) notify\(error instanceof Error/);
  assert.match(source, /if \(mountedRef\.current\) setBusy\(null\)/);
  for (const key of [
    '"assign" | "acknowledge" | "close"', '"POST"',
    "body: JSON.stringify({ organizationId, action, findingKey, ...extra })",
    "Inspection finding closed with verified evidence.",
    "setCloseReference(\"\")",
  ]) assert.ok(source.includes(key), key);
});

test("employee schedule refresh and retired correction POST cannot restore stale punch details", () => {
  const source = read(employeePath);
  assert.match(source, /correctionRevisionRef\.current \+= 1;\s*setSelected\(null\);\s*setSaving\(false\);\s*setPayload\(null\)/);
  assert.match(source, /currentLoad\.current\?\.abort\(\)/);
  assert.equal((source.match(/!mountedRef\.current \|\| currentLoad\.current !== controller \|\| controller\.signal\.aborted/g) ?? []).length, 2);
  assert.match(source, /const revision = \+\+correctionRevisionRef\.current/);
  assert.match(source, /const isCurrent = \(\) => mountedRef\.current && revision === correctionRevisionRef\.current/);
  assert.match(source, /const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!isCurrent\(\)\) return;/);
  assert.match(source, /if \(isCurrent\(\)\) setError\(cause/);
  assert.match(source, /if \(isCurrent\(\)\) setSaving\(false\)/);
  for (const key of [
    'action: "request_correction"', "punchId: selected.id",
    "proposedTimeIn: fromManilaInput(timeIn)", "proposedTimeOut: fromManilaInput(timeOut)",
    "manilaWorkDate()", "EmployeeScheduleReceipts", "EmployeeAvailabilityPreferences",
  ]) assert.ok(source.includes(key), key);
});

test("remove only three fixed effect allowances without weakening the global warning-debt gate", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, Record<string, { count: number }>>;
  for (const path of files) assert.equal(manifest[path], undefined, path);
  const count = Object.values(manifest).reduce(
    (total, rules) => total + (rules["react-hooks/set-state-in-effect"]?.count ?? 0), 0,
  );
  // A ceiling permits later legitimate cleanup to shrink the inventory further.
  assert.ok(count <= 31, "Remaining React effect lint debt exceeds the 31-count ceiling");
  assert.ok(Object.keys(manifest).length <= 24, "Effect lint file debt exceeds the 24-file ceiling");
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
