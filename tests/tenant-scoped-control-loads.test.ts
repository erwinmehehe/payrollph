import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type ProtectedPanel = {
  file: string;
  keyedInstance: string;
  requiredStateReset: string;
  payloadClear: string;
};

const panels: ProtectedPanel[] = [
  {
    file: "src/components/automation-studio-panel.tsx",
    keyedInstance: "<AutomationStudioPanelForOrganization key={props.organizationId}",
    requiredStateReset: "setData(null);",
    payloadClear: "setData(null);",
  },
  {
    file: "src/components/enterprise-controls-panel.tsx",
    keyedInstance: "<EnterpriseControlsPanelForOrganization key={props.organizationId}",
    requiredStateReset: "setOneTimeSecret(null);",
    payloadClear: "setData(null);",
  },
  {
    file: "src/components/workspace/managed-payroll-control-room.tsx",
    keyedInstance: "key={props.data.selectedOrganization.id}",
    requiredStateReset: "setPayload(null);",
    payloadClear: "setPayload(null);",
  },
];

for (const panel of panels) {
  test(panel.file + " isolates tenant state and retires synchronous effect loading", () => {
    const source = readFileSync(panel.file, "utf8");
    const loadStart = source.indexOf("  const load = useCallback(async () => {");
    const effectStart = source.indexOf(
      "  useEffect(() => { void load(); return cancelRead; }, [load, cancelRead]);",
      loadStart,
    );
    assert.ok(loadStart > 0 && effectStart > loadStart, "load must be async with stable cancellation cleanup");
    const loader = source.slice(loadStart, effectStart);
    assert.ok(source.includes(panel.keyedInstance), "changing tenant must remount the panel");
    assert.ok(source.includes(panel.requiredStateReset), "scope-local private drafts must be cleared on reset");
    assert.ok(!loader.includes("setLoading(true)"), "the mount effect cannot synchronously start loading");
    assert.ok(loader.includes("activeRead.current?.abort()"), "a superseded read must be aborted");
    assert.ok(loader.includes("const controller = new AbortController();"));
    assert.ok(loader.includes("signal: controller.signal"), "fetch must use the owning abort signal");
    assert.ok(loader.includes("if (controller.signal.aborted) return;"), "aborted reads must not commit results");
    assert.ok(loader.includes("if (!controller.signal.aborted) setLoading(false);"));
    assert.ok(loader.includes(panel.payloadClear), "read failures must not preserve stale controls");
    assert.ok(source.includes("const refresh = () => {"), "manual refresh must be explicit");
    assert.ok(source.includes("setLoading(true);"), "user-initiated refresh may transition to loading");
  });
}

test("managed payroll read failure cannot be misrepresented as an unenrolled pilot", () => {
  const source = readFileSync("src/components/workspace/managed-payroll-control-room.tsx", "utf8");
  const errorGate = source.indexOf("  if (loadError) {");
  const notEnabledGate = source.indexOf("  if (!payload?.engagement) {");
  assert.ok(errorGate > 0 && notEnabledGate > errorGate, "a failed or incomplete read must fail closed");
  assert.ok(source.includes('throw new Error("Managed payroll returned incomplete approval controls.");'));
  assert.ok(source.includes("setLoadError(message);"));
  assert.ok(source.includes("<h2>Controls unavailable</h2>"));
});

test("enterprise secrets never outlive the current tenant or an explicit refresh", () => {
  const source = readFileSync("src/components/enterprise-controls-panel.tsx", "utf8");
  assert.ok(source.includes("key={props.organizationId}"));
  assert.ok(source.includes("setOneTimeSecret(null);"));
  assert.ok(source.includes("setPolicy(payload.securityPolicy);"));
});

test("issue 774 manifest retires only these three newly scoped effect suppressions", () => {
  const manifest = JSON.parse(readFileSync("eslint-suppressions.json", "utf8")) as Record<string, unknown>;
  for (const panel of panels) {
    assert.equal(Object.hasOwn(manifest, panel.file), false, panel.file + " should not require an effect suppression");
  }
});
