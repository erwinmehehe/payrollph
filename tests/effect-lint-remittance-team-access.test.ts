import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const team = readFileSync("src/components/workspace/panels.tsx", "utf8");
const correction = readFileSync("src/components/workspace/statutory-remittance-corrections-panel.tsx", "utf8");
const suppression = JSON.parse(readFileSync("eslint-suppressions.json", "utf8")) as Record<string, unknown>;

test("team access remounts its private invite inputs and member permissions on employer change", () => {
  assert.ok(team.includes("<TeamAccessSettingsForOrganization key={props.data.selectedOrganization.id}"));
  assert.ok(team.indexOf("function TeamAccessSettingsForOrganization(") < team.indexOf("const [members, setMembers]"));
  assert.ok(team.includes('const [email, setEmail] = useState("");'));
  assert.ok(team.includes('const [role, setRole] = useState("payroll");'));
  assert.ok(team.includes('const [loadError, setLoadError] = useState("");'));
  assert.ok(!team.includes("eslint-disable-next-line react-hooks/exhaustive-deps"),
    "the old team access dependency waiver must not remain");
});

test("team access effects defer GET, abort obsolete reads and cannot publish empty membership on failure", () => {
  const begin = team.indexOf("  const loadTeam = useCallback(async ()");
  const end = team.indexOf("  const reloadTeam = () => {", begin);
  assert.ok(begin > 0 && end > begin);
  const loaderAndEffect = team.slice(begin, end);
  const beforeFirstFetch = loaderAndEffect.slice(0, loaderAndEffect.indexOf("await fetch("));
  assert.ok(!beforeFirstFetch.includes("setLoading(true)"), "no synchronous setState from the mount effect");
  for (const token of [
    "activeRead.current?.abort();",
    "signal: controller.signal",
    "if (controller.signal.aborted) return false;",
    "queueMicrotask(() => {",
    "controller.abort();",
    "activeRead.current?.abort();",
    "setMembers([]);",
    "setInvitations([]);",
    "setLoadError(err instanceof Error",
  ]) assert.ok(loaderAndEffect.includes(token), token);
  assert.ok(team.includes("Boolean(loadError) || !email.trim()"),
    "cannot invite if authorized role GET failed");
  assert.ok(team.includes("Retry access"));
  assert.ok(team.includes("Workspace members unavailable until access reload succeeds."));
  assert.ok(team.includes("Invitations unavailable until access reload succeeds."));
  assert.ok(team.includes("await reloadTeam();"),
    "mutations must explicitly re-enter the loading/authorization gate");
});

test("remittance correction editor owns drafts by record, not by resetting state in an effect", () => {
  assert.ok(correction.includes(
    "<StatutoryRemittanceCorrectionsPanelForOrganization key={JSON.stringify([props.organizationId, props.legalEntityId, props.viewerUserId, props.viewerRole, props.companyWide])}"
  ), "employer, entity, user and access changes must remount the correction editor");
  assert.equal(correction.split("useEffect(").length - 1, 1);
  assert.ok(correction.includes("paymentEdit && selectedBatch && paymentEdit.id === selectedBatch.id"));
  assert.ok(correction.includes("postingEdit && selectedMember && postingEdit.id === selectedMember.id"));
  assert.ok(correction.includes("paymentEdit && selectedBatch && paymentEdit.id === selectedBatch.id"),
    "empty batch selection must not dereference a null draft");
  assert.ok(correction.includes("postingEdit && selectedMember && postingEdit.id === selectedMember.id"),
    "empty member selection must not dereference a null draft");
  assert.ok(correction.includes("paymentDefaults(selectedBatch)"));
  assert.ok(correction.includes("postingDefaults(selectedMember)"));
  assert.ok(correction.includes("setPaymentEdit({ id: selectedBatch.id"));
  assert.ok(correction.includes("setPostingEdit({ id: selectedMember.id"));
  assert.ok(correction.includes('editPayment("paymentReference", event.target.value)'));
  assert.ok(correction.includes('editPosting("postingReference", event.target.value)'));
  assert.ok(correction.includes("setPaymentEdit(null);"));
  assert.ok(correction.includes("setPostingEdit(null);"));
});

test("remittance authoritative reads are abortable, current-tenant only and fail closed", () => {
  const begin = correction.indexOf("  const load = useCallback(async (signal?: AbortSignal)");
  const end = correction.indexOf("  const recordedBatches = useMemo(", begin);
  assert.ok(begin > 0 && end > begin);
  const scoped = correction.slice(begin, end);
  const beforeFirstFetch = scoped.slice(0, scoped.indexOf("await Promise.all("));
  assert.ok(beforeFirstFetch.includes('setReadState("loading");'),
    "deferred load must revoke ready state before either employer evidence request");
  assert.ok(beforeFirstFetch.includes("setCorrectionData(null);"),
    "previous permission evidence must be cleared before both reads");
  assert.ok(scoped.includes("queueMicrotask(() => {"),
    "the mount effect must defer the loading state transition");
  for (const statement of [
    "const revision = ++readRevisionRef.current;",
    "revision === readRevisionRef.current",
    'cache: "no-store", signal',
    "if (!isCurrent()) return false;",
    "setBatches([]);",
    "setMembers([]);",
    "setCorrectionData(null);",
    'setReadState("error");',
    'setReadState("ready");',
    "queueMicrotask(() => {",
    "controller.abort();",
    "readRevisionRef.current += 1;",
  ]) assert.ok(scoped.includes(statement), statement);
  assert.ok(correction.includes('if (readState !== "ready") {'));
  assert.ok(correction.includes("No correction requests or approvals are shown without authorized evidence."));
  assert.ok(correction.includes("recordedBatches.some((item) => item.id === selectedBatch.id)"));
  assert.ok(correction.includes("confirmedMembers.some((item) => item.id === selectedMember.id)"));
  assert.ok(correction.includes("!correctionData?.canRequest"));
  assert.ok(correction.includes("const isOwn = correction.requestedByUserId === correctionData?.currentUserId"));
  assert.ok(correction.includes("const canDecide = correctionData?.canApprove && !isOwn"));
  assert.ok(correction.includes('void decide(correction, "approve")'));
});

test("four retired #774 effect allowances are absent without changing other warning ceilings", () => {
  for (const path of [
    "src/components/workspace/panels.tsx",
    "src/components/workspace/statutory-remittance-corrections-panel.tsx",
  ]) assert.equal(suppression[path], undefined, path);
  assert.ok(readFileSync("scripts/check-lint-warning-debt.mjs", "utf8").includes("warningDebt"));
});
