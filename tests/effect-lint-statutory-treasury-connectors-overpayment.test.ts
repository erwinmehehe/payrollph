import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MONTH = "src/components/workspace/statutory-remittance-month-close.tsx";
const PROOF = "src/components/workspace/statutory-payment-proof.tsx";
const TREASURY = "src/components/treasury-controls-panel.tsx";
const SLACK = "src/components/slack-connector-admin.tsx";
const OVERPAYMENT = "src/components/payroll-overpayment-workbench.tsx";
const read = (path: string) => readFileSync(path, "utf8");

for (const path of [MONTH, PROOF, TREASURY, SLACK, OVERPAYMENT]) {
  test(path + " starts an abortable read outside synchronous effect setup", () => {
    const source = read(path);
    if (path === MONTH) {
      // The month-close controller belongs to load() so an event-driven
      // refresh aborts the previous request and hides any stale approval.
      assert.match(source, /const load = useCallback\(async \(\): Promise<VerifiedRemittanceMonthClose \| null> => \{/);
      assert.match(source, /activeRead\.current\?\.abort\(\)/);
      assert.match(source, /activeRead\.current = controller/);
      assert.match(source, /controller\.signal\.aborted/);
      assert.match(source, /setState\(null\)/);
    } else if (path === PROOF) {
      const hook = read("src/components/workspace/use-scoped-async-resource.tsx");
      assert.match(source, /readVerifiedPaymentProof\(organizationId, batchId, fetch, signal\)/);
      assert.match(source, /useScopedAsyncResource\(/);
      assert.match(hook, /new AbortController\(\)/);
      assert.match(hook, /\.abort\(\)/);
      assert.match(hook, /queueMicrotask\(/);
    } else {
      assert.match(source, /const load = useCallback\(async \(signal\?: AbortSignal\) => \{/);
      assert.match(source, /controller\.abort\(\)/);
      assert.match(source, /signal\?\.aborted/);
    }
    if (path !== PROOF) {
      assert.match(source, /new AbortController\(\)/);
      assert.match(source, /queueMicrotask\(/);
    }
    assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*void load\(\)/);
  });
}

test("remittance month close isolates employer/entity/month and removes the event listener", () => {
  const source = read(MONTH);
  assert.match(source, /StatutoryRemittanceMonthCloseContent key=/);
  assert.match(source, /props\.organizationId\}:\$\{props\.legalEntityId/);
  assert.match(source, /props\.applicableMonth/);
  assert.match(source, /window\.addEventListener\("statutory-remittance-changed", onChanged\)/);
  assert.match(source, /window\.removeEventListener\("statutory-remittance-changed", onChanged\)/);
  assert.match(source, /activeRead\.current\?\.abort\(\)/);
  assert.match(source, /if \(!controller\.signal\.aborted\) void load\(\)/);
  assert.match(source, /method: "POST"/);
});

test("statutory payment proof resets the selected file and replacement draft per batch", () => {
  const source = read(PROOF);
  assert.match(source, /StatutoryPaymentProofContent key=/);
  assert.match(source, /props\.organizationId\}:\$\{props\.batchId/);
  assert.ok(source.indexOf("function StatutoryPaymentProofContent") < source.indexOf("const [file, setFile]"));
  assert.match(source, /useScopedAsyncResource\(/);
  assert.match(source, /readVerifiedPaymentProof\(organizationId, batchId, fetch, signal\)/);
  assert.match(source, /if \(!proof\)/);
  assert.match(source, /setFile\(null\)/);
  assert.match(source, /setReplacementReason\(""\)/);
  assert.match(source, /form\.set\("file", file\)/);
});

test("treasury policy and Slack connector credentials remount per employer", () => {
  const treasury = read(TREASURY);
  const slack = read(SLACK);
  assert.match(treasury, /TreasuryControlsPanelContent key=\{props\.organizationId\}/);
  assert.match(slack, /SlackConnectorAdminContent key=\{props\.organizationId\}/);
  assert.match(treasury, /if \(!signal\?\.aborted\) setLoading\(false\)/);
  assert.match(slack, /if \(!signal\?\.aborted\) setLoading\(false\)/);
  assert.match(treasury, /action: "save-policy"/);
  assert.match(slack, /action: "save-slack"/);
  assert.match(slack, /action: "set-active"/);
});

test("overpayment inspection remains read-only and clears prior-employer drafts on remount", () => {
  const source = read(OVERPAYMENT);
  assert.match(source, /PayrollOverpaymentWorkbenchContent key=\{props\.organizationId\}/);
  assert.ok(source.indexOf("function PayrollOverpaymentWorkbenchContent") < source.indexOf("const [form, setForm]"));
  assert.match(source, /data\.readOnly === true/);
  assert.match(source, /cache: "no-store", signal/);
  assert.doesNotMatch(source, /let active = true/);
  assert.match(source, /method: "POST"/);
});

test("only the five resolved single-count effect lint allowances are retired", () => {
  const baseline = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  for (const path of [MONTH, PROOF, TREASURY, SLACK, OVERPAYMENT]) {
    assert.equal(baseline[path], undefined, path);
  }
});
