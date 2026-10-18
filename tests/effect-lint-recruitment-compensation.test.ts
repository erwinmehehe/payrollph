import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const RECRUITMENT = "src/components/recruitment-panel.tsx";
const COMPENSATION = "src/components/compensation-panel.tsx";
const read = (path: string) => readFileSync(path, "utf8");
const recruitment = read(RECRUITMENT);
const compensation = read(COMPENSATION);

test("candidate PII, offer pay and hire forms belong to one employer at a time", () => {
  assert.ok(recruitment.includes("<RecruitmentPanelForOrganization key={props.organizationId}"));
  const child = recruitment.indexOf("function RecruitmentPanelForOrganization(");
  const form = recruitment.indexOf("const [formApp, setFormApp]");
  const salary = recruitment.indexOf("const [hireForm, setHireForm]");
  assert.ok(child > 0 && form > child && salary > child);
  assert.ok(recruitment.includes("const [loading, setLoading] = useState(true)"));
  assert.ok(recruitment.includes("const [loadError, setLoadError] = useState<string | null>(null)"));
});

test("recruitment mount defers network reads and late employer data cannot be rendered", () => {
  const loadStart = recruitment.indexOf("  const load = useCallback(async (signal?: AbortSignal)");
  const effectStart = recruitment.indexOf("  useEffect(() => {", loadStart);
  const reloadStart = recruitment.indexOf("  const reload = () => {", effectStart);
  assert.ok(loadStart > 0 && effectStart > loadStart && reloadStart > effectStart);
  const load = recruitment.slice(loadStart, effectStart);
  const effect = recruitment.slice(effectStart, reloadStart);
  for (const guard of [
    "const revision = ++requestRevisionRef.current",
    "!signal?.aborted && revision === requestRevisionRef.current",
    "signal,",
    "if (!isCurrent()) return false",
    "setRequisitions([])",
    "setApplicants([])",
    "setCanPublishCareers(false)",
    "setLoadError(message)",
    "if (isCurrent()) setLoading(false)",
  ]) assert.ok(load.includes(guard), guard);
  assert.ok(!load.slice(0, load.indexOf("await fetch(")).includes("setLoading("));
  for (const guard of ["queueMicrotask(() => {", "if (!controller.signal.aborted) void load(controller.signal)", "controller.abort()", "requestRevisionRef.current += 1"]) {
    assert.ok(effect.includes(guard), guard);
  }
  assert.ok(!effect.includes("setLoading("), "mount effect cannot synchronously reset state");
  assert.ok(recruitment.includes('data-recruitment-source="unavailable"'));
  assert.ok(recruitment.includes("Candidate records and hiring controls remain unavailable"));
  assert.ok(recruitment.includes("Retry recruitment data"));
});

test("successful hires are never repeated just because independent reads fail", () => {
  assert.equal((recruitment.match(/await reload\(\)/g) ?? []).length, 4);
  assert.ok(!recruitment.includes("await load();"));
  assert.ok(recruitment.includes("const recruitmentReloaded = await reload().catch(() => false)"));
  assert.ok(recruitment.includes("await onHired?.()"));
  assert.ok(recruitment.includes("Do not resubmit the hire."));
  assert.ok(recruitment.includes("setConsentEvidenceConfirmed(false)"));
});

test("compensation GETs cannot republish a previous employer's pay or authorization", () => {
  assert.ok(compensation.includes("<ScopedCompensationPanel key={props.organizationId}"));
  assert.ok(compensation.includes("readControllerRef.current?.abort();"));
  assert.ok(compensation.includes("signal: controller.signal"));
  assert.ok(compensation.includes("const isCurrent = () => !controller.signal.aborted && requestSequence.current === requestId"));
  assert.ok(compensation.includes("if (!isCurrent()) return"));
  assert.ok(compensation.includes("if (isCurrent()) setLoading(false)"));
  assert.ok(compensation.includes("setLoadedOrganizationId(null)"));
  assert.ok(compensation.includes('data-hcm-compensation-source="unavailable"'));
  assert.ok(compensation.includes("if (loading || loadedOrganizationId !== organizationId || !access)"));
});

test("compensation effect only schedules work; every post-write refresh blocks controls", () => {
  const effectStart = compensation.indexOf("  useEffect(() => {");
  const reloadStart = compensation.indexOf("  const reload = () => {", effectStart);
  assert.ok(effectStart > 0 && reloadStart > effectStart);
  const effect = compensation.slice(effectStart, reloadStart);
  assert.ok(effect.includes("queueMicrotask(() => {"));
  assert.ok(effect.includes("if (!controller.signal.aborted) void load()"));
  assert.ok(effect.includes("controller.abort()"));
  assert.ok(effect.includes("invalidateInFlightLoad()"));
  assert.ok(!effect.includes("setLoading("));
  assert.ok(compensation.includes("setLoadedOrganizationId(null);\n    setLoading(true);\n    setFailedLoad(null);"));
  assert.equal((compensation.match(/await reload\(\)/g) ?? []).length, 3);
  assert.ok(compensation.includes("if (response.status === 409) await reload()"));
  assert.ok(!compensation.includes("await load();"));
});

test("retire precisely recruitment and compensation allowances; retain strict warning budget", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(manifest[RECRUITMENT], undefined);
  assert.equal(manifest[COMPENSATION], undefined);
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
