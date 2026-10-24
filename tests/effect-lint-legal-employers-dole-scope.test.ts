import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const legalPath = "src/components/legal-entities-panel.tsx";
const dolePath = "src/components/workspace/dole-thirteenth-month-report-panel.tsx";
const sources = [legalPath, dolePath];
const read = (path: string) => readFileSync(path, "utf8");

test("legal-employer statutory and bank administration state remounts with employer workspace", () => {
  const source = read(legalPath);
  assert.match(source, /ScopedLegalEntitiesPanel key=\{props\.organizationId\}/);
  assert.ok(source.indexOf("function ScopedLegalEntitiesPanel(") < source.indexOf("const [entities, setEntities]"));
  assert.match(source, /const \[formDraft, setFormDraft\] = useState<\{ entityId: number \| null; value: FormState \} \| null>\(null\)/);
  assert.match(source, /const scopedId = creating \? null : selected\?\.id \?\? null/);
  assert.match(source, /const form = formDraft\?\.entityId === scopedId/);
});

test("employer form derives readonly selected employer fields and scopes every user edit, not effect state", () => {
  const source = read(legalPath);
  assert.match(source, /selected \? fromEntity\(selected\) : blank/);
  assert.match(source, /setFormDraft\(\(current\) => \{/);
  assert.match(source, /entityId: scopedId/);
  assert.match(source, /value: typeof value === "function" \? value\(previous\) : value/);
  assert.doesNotMatch(source, /\[selected, creating\]\)/);
  assert.match(source, /onClick=\{\(\) => \{ setCreating\(false\); setSelectedId\(entity\.id\); setFormDraft\(null\); \}\}/);
  assert.match(source, /onClick=\{\(\) => \{ setCreating\(true\); setFormDraft\(\{ entityId: null, value: blank \}\); \}\}/);
  assert.match(source, /onCancel=\{\(\) => \{ setCreating\(false\); setFormDraft\(null\); \}\}/);
  assert.match(source, /disbursementAccount: ""/);
});

test("both initial loads defer effect-phase state work and cancel all retired requests", () => {
  for (const path of sources) {
    const source = read(path);
    assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1, path);
    assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/, path);
    assert.match(source, /retired = true;\s*mountedRef\.current = false;\s*loadRevisionRef\.current \+= 1;/, path);
    assert.match(source, /loadControllerRef\.current\?\.abort\(\)/, path);
    assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
    assert.match(source, /const isCurrent = \(\) =>\s*mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
    if (path === dolePath) {
      // Main now calls the endpoint directly and checks the strict merged read contract.
      // Retain abort, HTTP denial, entity/year identity, and before-use proof checks.
      const reader = read("src/lib/dole-thirteenth-read.ts");
      assert.match(source, /cache: "no-store", signal: controller\.signal/);
      assert.match(source, /parseDoleThirteenthRead\(response\.ok, value, organizationId, taxYear\)/);
      assert.match(source, /if \(!body\)/);
      assert.match(reader, /v\.organizationId !== organizationId \|\| v\.legalEntityId !== null/);
      assert.match(reader, /v\.currentSubmission\.reportHash !== v\.reportHash/);
    } else {
      assert.match(source, /cache: "no-store", signal: controller\.signal/);
    }
    assert.match(source, /if \(!isCurrent\(\)\) return false;/);
    assert.match(source, /if \(isCurrent\(\)\) setLoading\(false\)/);
  }
});

test("legal employer GET fails closed without implying zero registered entities or valid payroll boundaries", () => {
  const source = read(legalPath);
  assert.match(source, /setEntities\(\[\]\);\s*setEmployees\(\[\]\);\s*setFormDraft\(null\)/);
  assert.match(source, /if \(loading \|\| loadError\) return \(/);
  assert.match(source, /Loading legal employers/);
  assert.match(source, /className="notice notice-red"/);
  assert.match(source, /setLoadError\(message\)/);
  assert.match(source, /onClick=\{\(\) => void load\(\)\}>Retry/);
  assert.match(source, /setSelectedId\(\(current\) =>\s*current && nextEntities\.some\(\(entity\) => entity\.id === current\)/);
});

test("legal employers retain audited registration/payroll actions and discard stale mutation completions", () => {
  const source = read(legalPath);
  for (const key of [
    'action: "update_entity"', 'action: "assign_employee"', 'action: "set_primary"',
    'action: "set_active"', 'method: "PATCH"', 'method: "POST"',
    "releasedPayrollRuns", "payrollCalendarMode", "statutoryDeductionTiming",
    "disbursementAccount: form.disbursementAccount.trim()",
    "Employee legal employer updated.", "Existing released payroll blocks",
  ]) assert.ok(source.includes(key), key);
  assert.equal((source.match(/readRevision !== loadRevisionRef\.current/g) ?? []).length, 2);
  assert.match(source, /if \(!mountedRef\.current \|\| !refreshed\) return false/);
  assert.match(source, /if \(mountedRef\.current\) setSaving\(null\)/);
  assert.match(source, /if \(saved\) setFormDraft\(null\)/);
});

test("DOLE annual evidence state belongs to a particular legal employer", () => {
  const source = read(dolePath);
  assert.match(source, /ScopedDoleThirteenthMonthReportPanel key=\{props\.organizationId\}/);
  assert.ok(source.indexOf("function ScopedDoleThirteenthMonthReportPanel(") < source.indexOf("const [taxYear, setTaxYear]"));
  assert.match(source, /setState\(null\);\s*setPortalReference\(""\);\s*setProfile\(\{/);
  assert.match(source, /organizationId=\$\{organizationId\}&taxYear=\$\{taxYear\}/);
  assert.match(source, /const \[taxYear, setTaxYear\] = useState\(currentYear\(\)\)/);
});

test("DOLE annual report and portal proof are guarded by scoped, abortable reads and stale-response fences", () => {
  const source = read(dolePath);
  assert.match(source, /loadRevisionRef\.current \+= 1;\s*mutationRevisionRef\.current \+= 1;\s*loadControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /const readRevision = loadRevisionRef\.current/);
  assert.match(source, /const isCurrentMutation = \(\) =>\s*mountedRef\.current && revision === mutationRevisionRef\.current\s*&& readRevision === loadRevisionRef\.current/);
  assert.match(source, /const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!isCurrentMutation\(\)\) return;/);
  assert.match(source, /if \(isCurrentMutation\(\)\) notify\(mutationError/);
  assert.match(source, /if \(mountedRef\.current && revision === mutationRevisionRef\.current\) setSaving\(false\)/);
});

test("DOLE report preserves source worksheet vs actual filing distinction and report hash evidence", () => {
  const source = read(dolePath);
  for (const key of [
    '"save_profile" | "record_submission"',
    "state.submissionCurrent", "state.latestSubmission",
    "state.reportHash.slice(0, 12)", "state.submissionHistory.slice(0, 8)",
    "state.report.totalBenefitsGranted", "state.reviewRows.length > 0",
    "state.incompleteBasicRows.length > 0",
    'onClick={() => void mutate("record_submission", { portalReference, submittedAt })}',
    "portalReference.trim().length < 4",
    "Only record this after the employer submitted the report through DOLE.",
    "Generation or download alone never marks the report submitted.",
    "The generated CSV is a source worksheet, not an OCP upload template.",
    "The portal acknowledgement remains external evidence",
  ]) assert.ok(source.includes(key), key);
});

test("remove exactly three fixed React effect allowances without relaxing warning-debt gate", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, Record<string, { count: number }>>;
  for (const path of sources) assert.equal(manifest[path], undefined, path);
  const count = Object.values(manifest).reduce(
    (n, rules) => n + (rules["react-hooks/set-state-in-effect"]?.count ?? 0), 0,
  );
  assert.ok(count <= 22, "React set-state-in-effect warning debt exceeds 22");
  assert.ok(Object.keys(manifest).length <= 17, "React effect lint file debt exceeds 17");
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
