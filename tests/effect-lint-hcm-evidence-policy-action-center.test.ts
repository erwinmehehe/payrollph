import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const evidencePath = "src/components/hcm-employment-decision-evidence.tsx";
const policyPath = "src/components/hcm-lifecycle-policy-panel.tsx";
const actionCenterPath = "src/components/hcm-employment-lifecycle-action-center.tsx";
const paths = [evidencePath, policyPath, actionCenterPath];
const read = (path: string) => readFileSync(path, "utf8");

test("employment decision packets and lifecycle policies remount on employer/decision change", () => {
  const evidence = read(evidencePath);
  const policy = read(policyPath);
  const center = read(actionCenterPath);
  assert.match(evidence, /ScopedHcmEmploymentDecisionEvidence\s+key=\{props\.organizationId \+ ":" \+ props\.decisionId\}/);
  assert.match(policy, /ScopedHcmLifecyclePolicyPanel key=\{props\.organizationId\}/);
  assert.match(center, /ScopedHcmEmploymentLifecycleActionCenter key=\{hcmReadScopeKey\(scope\)\}/);
  assert.ok(evidence.indexOf("function ScopedHcmEmploymentDecisionEvidence(") < evidence.indexOf("const [payload, setPayload]"));
  assert.ok(policy.indexOf("function ScopedHcmLifecyclePolicyPanel(") < policy.indexOf("const [payload, setPayload]"));
});

test("all three mount reads defer effect-phase updates and retire the Strict Mode first pass", () => {
  for (const path of paths) {
    const source = read(path);
    assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/, path);
    assert.match(source, /return \(\) => \{\s*retired = true;/, path);
    assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1, path);
    assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void load\(\)/, path);
  }
});

test("private decision and policy GETs are abortable and generation fenced", () => {
  for (const path of [evidencePath, policyPath]) {
    const source = read(path);
    assert.match(source, /const revision = \+\+requestRevisionRef\.current/);
    assert.match(source, /const isCurrent = \(\) =>\s*mountedRef\.current && !controller\.signal\.aborted && revision === requestRevisionRef\.current/);
    assert.match(source, /requestControllerRef\.current\?\.abort\(\)/);
    assert.match(source, /requestRevisionRef\.current \+= 1/);
    assert.match(source, /cache: "no-store", signal: controller\.signal/);
    assert.match(source, /if \(!isCurrent\(\)\) return;/);
  }
});

test("stale evidence is hidden on refresh and old upload/attestation responses cannot touch the new decision", () => {
  const source = read(evidencePath);
  assert.match(source, /A refresh must not keep a formerly authorized private packet on screen\.\s*setPayload\(null\);\s*setError\(""\)/);
  const guard = /const data = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return;/g;
  assert.equal((source.match(guard) ?? []).length, 3);
  assert.equal((source.match(/if \(mountedRef\.current\) await onChanged\?\.\(\)/g) ?? []).length, 3);
  assert.equal((source.match(/if \(mountedRef\.current\) setBusy\(false\)/g) ?? []).length, 3);
  assert.equal((source.match(/if \(mountedRef\.current\) setError\(mutationError/g) ?? []).length, 3);
  assert.match(source, /const \[file, setFile\] = useState<File \| null>\(null\)/);
});

test("policy refresh hides revoked management controls and retired saves cannot update current employer", () => {
  const source = read(policyPath);
  assert.match(source, /setPayload\(null\);\s*setEditing\(false\);\s*setError\(""\)/);
  assert.match(source, /const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return;/);
  assert.match(source, /if \(mountedRef\.current\) setBusy\(false\)/);
  assert.match(source, /if \(mountedRef\.current\) setError\(saveError/);
  assert.match(source, /payload\?\.canManage && !editing/);
});

test("action center still requires a legal employer, validates responses, and aborts stale requests", () => {
  const source = read(actionCenterPath);
  for (const key of [
    "hcmReadScopeValid(scope)",
    "hcmReadScopeKey(scope)",
    "hcmReadScopeParams(selection)",
    "hcmResponseMatchesReadScope(data, selection)",
    "activeRequest.current?.abort()",
    "if (controller.signal.aborted) return;",
    "setPayload(null)",
    "Select one legal employer.",
  ]) assert.ok(source.includes(key), key);
  assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/);
  assert.match(source, /retired = true;\s*activeRequest\.current\?\.abort\(\)/);
});

test("server-side evidence append, manager recommendation, policy version, and upload contracts survive unchanged", () => {
  const evidence = read(evidencePath);
  const policy = read(policyPath);
  for (const key of [
    "/api/hcm/employment-term-decisions/",
    "/manager-attestation",
    'method: "POST"',
    "organizationId,",
    "noteKind,",
    "managerRecommendation",
    'form.set("organizationId", String(organizationId))',
    'form.set("file", file)',
    "packet.integrity",
  ]) assert.ok(evidence.includes(key), key);
  for (const key of [
    'method: "PATCH"',
    '"/api/hcm/lifecycle-policy"',
    "expectedVersion: payload.policy.version",
    "requireManagerReviewForProbation",
    "requireDecisionRationaleNote",
    "requireNonRenewalAttachment",
    "canManage",
  ]) assert.ok(policy.includes(key), key);
});

test("only three corresponding effect allowances are retired, never the global lint rule", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, Record<string, { count: number }>>;
  for (const path of paths) assert.equal(manifest[path], undefined, path);
  assert.equal(Object.values(manifest).reduce((n, rules) => n + (rules["react-hooks/set-state-in-effect"]?.count ?? 0), 0), 34);
  assert.equal(Object.keys(manifest).length, 27);
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
