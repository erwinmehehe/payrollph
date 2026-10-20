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
    keyedInstance: "key={JSON.stringify([props.data.selectedOrganization.id, props.data.user?.id",
    requiredStateReset: "setPayload(null);",
    payloadClear: "setPayload(null);",
  },
];

for (const panel of panels) {
  test(panel.file + " isolates tenant state and retires synchronous effect loading", () => {
    const source = readFileSync(panel.file, "utf8");
    const managed = panel.file === "src/components/workspace/managed-payroll-control-room.tsx";
    const loadStart = source.indexOf(managed
      ? "  const load = useCallback(async (): Promise<boolean> => {"
      : "  const load = useCallback(async () => {");
    const effectStart = source.indexOf("  useEffect(() => {", loadStart);
    assert.ok(loadStart > 0 && effectStart > loadStart, "load must be async with stable cancellation cleanup");
    const loader = source.slice(loadStart, effectStart);
    const effectEnd = source.indexOf("  const refresh = () => {", effectStart);
    assert.ok(effectEnd > effectStart, "mount effect must precede manual refresh");
    const mountEffect = source.slice(effectStart, effectEnd);
    assert.ok(mountEffect.includes("queueMicrotask(() => {"), "mount effect must defer the GET");
    assert.ok(mountEffect.includes("if (!controller.signal.aborted) void load();"));
    assert.ok(mountEffect.includes("controller.abort();"), "unmount cancels queued GET");
    assert.ok(mountEffect.includes("cancelRead();"), "unmount cancels in-flight GET");
    assert.ok(!mountEffect.includes("setLoading("), "effect cannot synchronously reset state");
    assert.ok(source.includes(panel.keyedInstance), "changing tenant must remount the panel");
    assert.ok(source.includes(panel.requiredStateReset), "scope-local private drafts must be cleared on reset");
    if (managed) {
      const requestAt = loader.indexOf("await fetch(");
      assert.ok(requestAt > 0, "managed payroll must request fresh employer evidence");
      assert.ok(loader.indexOf("setPayload(null);") < requestAt,
        "previous approval evidence must be revoked before the GET");
      assert.ok(loader.indexOf("setLoading(true);") < requestAt,
        "a deferred loader may indicate loading but must never expose stale approvals");
      assert.ok(source.includes("viewerUserId") && source.includes("parseManagedPayrollRead("),
        "employer/user identity must be bound to the response");
    } else {
      assert.ok(!loader.includes("setLoading(true)"), "the mount effect cannot synchronously start loading");
    }
    assert.ok(loader.includes("activeRead.current?.abort()"), "a superseded read must be aborted");
    assert.ok(loader.includes("const controller = new AbortController();"));
    assert.ok(loader.includes("signal: controller.signal"), "fetch must use the owning abort signal");
    assert.ok(loader.includes(managed
      ? "if (controller.signal.aborted) return false;"
      : "if (controller.signal.aborted) return;"), "aborted reads must not commit results");
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
  assert.ok(source.includes('throw new Error("Managed payroll employer, approver or gate evidence could not be verified.");'));
  assert.ok(source.includes("parseManagedPayrollRead(body, { organizationId, viewerUserId })"));
  assert.ok(source.includes("setPayload(null);"), "stale managed approvals must be withdrawn before retry");
  assert.ok(source.includes("setLoadError(message);"));
  assert.ok(source.includes("<h2>Controls unavailable</h2>"));
});

test("enterprise secrets never outlive the current tenant or an explicit refresh", () => {
  const source = readFileSync("src/components/enterprise-controls-panel.tsx", "utf8");
  assert.ok(source.includes("key={props.organizationId}"));
  assert.ok(source.includes("setOneTimeSecret(null);"));
  assert.ok(source.includes("setPolicy(payload.securityPolicy);"));
});

test("issue 774 manifest retires only these four newly scoped effect suppressions", () => {
  const manifest = JSON.parse(readFileSync("eslint-suppressions.json", "utf8")) as Record<string, unknown>;
  for (const file of [...panels.map((panel) => panel.file), "src/components/workforce-planning-panel.tsx"]) {
    assert.equal(Object.hasOwn(manifest, file), false, file + " should not require an effect suppression");
  }
});

test("workforce planning isolates employer-scoped budgets and retries without effect resets", () => {
  const source = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
  assert.ok(source.includes("<WorkforcePlanningPanelForOrganization key={props.organizationId}"));
  const loadStart = source.indexOf("  const load = useCallback(async () => {");
  const effectStart = source.indexOf("  useEffect(() => {", loadStart);
  assert.ok(loadStart > 0 && effectStart > loadStart);
  const loader = source.slice(loadStart, effectStart);
  const effectEnd = source.indexOf("  // Explicit user/mutation reloads", effectStart);
  assert.ok(effectEnd > effectStart);
  const mountEffect = source.slice(effectStart, effectEnd);
  assert.ok(mountEffect.includes("queueMicrotask(() => {"), "mount effect must defer GET");
  assert.ok(mountEffect.includes("if (!controller.signal.aborted) void load();"));
  assert.ok(mountEffect.includes("controller.abort();"), "unmount must cancel queued GET");
  assert.ok(mountEffect.includes("invalidateInFlightLoad();"), "unmount must revoke old results");
  assert.ok(!mountEffect.includes("setLoading("), "mount effect cannot synchronously update state");
  const firstRead = loader.indexOf("await fetch(");
  assert.ok(firstRead > 0);
  assert.ok(!loader.slice(0, firstRead).includes("setLoading(true)"));
  assert.ok(!loader.slice(0, firstRead).includes("setLoadError(null)"));
  assert.ok(loader.includes("const revision = ++loadRevisionRef.current"));
  assert.ok(loader.includes("if (revision !== loadRevisionRef.current) return;"));
  assert.ok(source.includes("loadRevisionRef.current += 1;"), "unmount must invalidate unfinished reads");
  assert.ok(source.includes("setLoadedOrganizationId(null);"));
  assert.ok(source.includes("const reload = () => {"));
  assert.ok(source.includes("const refresh = () => { void reload(); };"));
  assert.ok(source.includes("await reload();"), "writes must re-enter the blocking loader");
  assert.ok(!source.includes("await load();"), "mutations must not bypass explicit loading");
  assert.ok(source.includes("onClick={refresh} disabled={loading}>Retry"));
  assert.ok(source.includes("onClick={refresh} disabled={loading}><RefreshCw"));
  assert.ok(source.includes("setLoadError(null);\n      setLoadedOrganizationId(organizationId);"),
    "a successful authorized reload must clear the previous error");
});
