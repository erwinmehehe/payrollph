import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PEOPLE = "src/components/workspace/people.tsx";
const read = (path: string) => readFileSync(path, "utf8");
const source = read(PEOPLE);

test("employee drawer remounts for organization, person and access downgrade", () => {
  assert.ok(source.includes('key={data.selectedOrganization.id + ":" + selected.id + ":" + String(canManage)}'));
  const drawer = source.indexOf("function PersonDrawer(");
  const payBank = source.indexOf('const [replacementBankAccount, setReplacementBankAccount] = useState("");');
  const privateProfile = source.indexOf("const [connectedProfile, setConnectedProfile]");
  assert.ok(drawer > 0 && payBank > drawer && privateProfile > drawer);
  assert.ok(!source.includes("eslint-disable-next-line react-hooks/exhaustive-deps"));
});

test("payout approval GET is abortable, employee-scoped and fails closed", () => {
  const begin = source.indexOf("  const refreshPayoutChanges = useCallback(");
  const effect = source.indexOf("  useEffect(() => {", begin);
  const end = source.indexOf("  const reloadPayoutChanges = () => {", effect);
  assert.ok(begin >= 0 && effect > begin && end > effect);
  const load = source.slice(begin, effect);
  const mountEffect = source.slice(effect, end);
  for (const item of [
    "const revision = ++payoutReadRevisionRef.current",
    "!signal?.aborted && revision === payoutReadRevisionRef.current",
    "organizationId=${data.selectedOrganization.id}&employeeId=${employee.id}",
    'cache: "no-store", signal',
    "if (!isCurrent()) return false",
    "Array.isArray(payload.requests)",
    "setPayoutChangeRequests([])",
    'setPayoutReadState("error")',
    'setPayoutReadState("ready")',
  ]) assert.ok(load.includes(item), item);
  for (const item of [
    "queueMicrotask(() => {",
    "if (!controller.signal.aborted) void refreshPayoutChanges(controller.signal)",
    "controller.abort()",
    "payoutReadRevisionRef.current += 1",
  ]) assert.ok(mountEffect.includes(item), item);
  assert.ok(!mountEffect.includes("setPayoutChangeRequests("));
});

test("payout mutation and independent decision controls cannot proceed after a failed read", () => {
  assert.ok(source.includes('if (payoutReadState !== "ready") {'));
  assert.ok(source.includes("Payout approvals remain unavailable until this read succeeds."));
  assert.ok(source.includes("Retry payout approvals"));
  assert.ok(source.includes('disabled={savingPayout || payoutReadState !== "ready" || !bankCode.trim()}'));
  assert.ok(source.includes('(payoutReadState === "ready" ? payoutChangeRequests : []).filter'));
  assert.ok(source.includes('const requested = payoutChangeRequests.find((row) => row.id === requestId && row.status === "pending")'));
  assert.ok(source.includes("requested.requestedByUserId === data.user.id"));
  assert.ok(source.includes('["owner", "admin", "bookkeeper"].includes(data.access.role)'));
  assert.equal((source.match(/await reloadPayoutChanges\(\)/g) ?? []).length, 3);
  assert.ok(source.includes('decision: "approve" | "reject"'));
});

test("connected worker profile GET validates employee identity and retires obsolete reads", () => {
  const start = source.indexOf("  const loadConnectedProfile = useCallback(");
  const effect = source.indexOf("  useEffect(() => {", start);
  const refresh = source.indexOf("  async function refreshConnectedProfile()", effect);
  assert.ok(start > 0 && effect > start && refresh > effect);
  const load = source.slice(start, effect);
  const mount = source.slice(effect, refresh);
  for (const item of [
    "const revision = ++connectedReadRevisionRef.current",
    "!signal?.aborted && revision === connectedReadRevisionRef.current",
    "organizationId=${data.selectedOrganization.id}&employeeId=${employee.id}",
    'cache: "no-store", signal',
    "if (!isCurrent()) throw new Error",
    "payload.employee?.id !== employee.id",
    "payload.employee?.organizationId !== data.selectedOrganization.id",
    "setConnectedProfile(null)",
    "setConnectedError(",
    "if (isCurrent()) setConnectedLoading(false)",
  ]) assert.ok(load.includes(item), item);
  assert.ok(mount.includes("queueMicrotask(() => {"));
  assert.ok(mount.includes("if (!controller.signal.aborted) void loadConnectedProfile(controller.signal).catch"));
  assert.ok(mount.includes("controller.abort()"));
  assert.ok(mount.includes("connectedReadRevisionRef.current += 1"));
  assert.ok(!mount.includes("setConnectedLoading("), "effect must never synchronously write state");
  assert.ok(source.includes("setConnectedLoading(true);\n    return loadConnectedProfile();"));
  assert.ok(source.includes('const [connectedLoading, setConnectedLoading] = useState(canManage)'));
});

test("employee payout and HCM server-side role scopes remain the source of truth", () => {
  const payout = read("src/app/api/payout-destination-changes/route.ts");
  const worker = read("src/app/api/hcm/worker-profile/route.ts");
  assert.ok(payout.includes("assertMembership"));
  assert.ok(payout.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(worker.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(worker.includes("assertOrganizationRole"));
  assert.ok(worker.includes("assertScope(access, employee.orgUnitId)"));
});

test("retire both People drawer effect suppressions without relaxing lint", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  assert.equal(manifest[PEOPLE], undefined);
  assert.equal(source.split("useEffect(").length - 1, 2);
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
