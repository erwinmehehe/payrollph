import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const paths = [
  "src/components/workspace/payroll-assurance-panel.tsx",
  "src/components/workspace/payroll-connected-impact-panel.tsx",
  "src/components/performance-development-self-panel.tsx",
];

test("changing employer, legal entity, or payroll run remounts assurance and its local CSV evidence before painting", () => {
  const source = read(paths[0]);
  assert.match(source, /PayrollAssurancePanelContent key=\{\[props\.organizationId, props\.legalEntityId, props\.runId\]\.join\(":"\)\}/,
    "the remount key must include employer and legal entity, not just run ID");
  assert.match(source, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(source, /const \[parallelRows, setParallelRows\] = useState<ParallelPayrollRow\[]>\(\[\]\)/);
  assert.match(source, /const \[payload, setPayload\] = useState<AssurancePayload \| null>\(null\)/);
  assert.doesNotMatch(source, /\n    setLoading\(true\);\n    setFailed\(false\);/,
    "effects must not synchronously reset state after a tenant/run switch");
  assert.match(source, /isVerifiedAssuranceRead\(body, \{ organizationId, legalEntityId, runId \}\)/,
    "HTTP success alone must not authorize a green assurance state");
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(!alive\) return;\s*setPayload\(data\)/);
  assert.match(source, /return \(\) => \{\s*alive = false;\s*controller\.abort\(\);/,
    "old tenant/run requests must be cancelled and must not repaint the panel");
  assert.match(source, /setPayload\(null\);\s*setFailed\(true\)/,
    "incomplete or denied assurance reads must fail closed");
  assert.match(source, /Do not treat this as zero blockers\./);
  assert.match(source, /setRetryRevision\(\(revision\) => revision \+ 1\)/,
    "a user retry must trigger a new validation without preserving a stale success");
});

test("changing payroll run remounts default-off connected impact; manual refresh owns reset", () => {
  const source = read(paths[1]);
  assert.match(source, /PayrollConnectedImpactContent key=\{props\.runId\}/);
  assert.match(source, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(source, /response\.status === 204/);
  assert.match(source, /if \(!enabled\) return null;/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /function refresh\(\) \{\s*\/\/ Reset synchronously with the user event/);
  assert.match(source, /onClick=\{refresh\}/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*const controller = new AbortController\(\);\s*setReport/);
});

test("self-service development GET is cancellable, scoped and fails closed without synthetic plans", () => {
  const source = read(paths[2]);
  assert.match(source, /useScopedAsyncResource\(/);
  assert.match(source, /"self-performance-development"/);
  assert.match(source, /fetchPlans = useCallback\(async \(signal: AbortSignal\)/);
  assert.match(source, /cache: "no-store",\s*signal,/);
  assert.match(source, /if \(!Array\.isArray\(payload\?\.plans\)\)/);
  assert.match(source, /const plans = currentPlans \?\? \[\]/);
  assert.match(source, /await reload\(\);/);
  assert.doesNotMatch(source, /useEffect\s*\(/);
});

test("three warnings are retired per file without relaxing any ESLint rule", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  for (const path of paths) {
    assert.equal(manifest[path], undefined, path + " should have no unearned lint allowance");
  }
  assert.match(read("scripts/check-lint-warning-debt.mjs"), /warningDebt/);
});
