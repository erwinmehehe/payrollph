import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXPORTS_POST_METHOD, EXPORTS_POST_TITLE, assertDisbursementPayload, assertExportsDenial, assertRowsUnchanged,
} from "../scripts/qa/tenant-payroll-exports-post-contract.mjs";
import { assertPaymongoHttpProofTarget, syntheticPaymongoUrl } from "../scripts/qa/paymongo-http-proof-target.mjs";

test("this is the payroll exports POST proof and carries no coverage claim", () => {
  assert.equal(EXPORTS_POST_METHOD, "POST payroll-runs/[id]/exports");
  assert.equal(EXPORTS_POST_TITLE, "tenant-payroll-exports-post-isolation");
});

test("the proof target accepts only isolated CI with the exact synthetic PayMongo credentials", () => {
  const safe = {
    CI: "true", GITHUB_ACTIONS: "true", PAYMONGO_HTTP_PROOF: "loopback-only", PAYMONGO_SECRET_KEY: "sk_test_synthetic_no_network",
    PAYMONGO_WALLET_ID: "wallet_synthetic", PAYMONGO_DISBURSEMENTS_ENABLED: "true", PAYROLL_PAYOUT_PROVIDER: "paymongo",
    MONEY_PROOF_URL: "http://127.0.0.1:3011", MONEY_PROOF_MODE: "disposable-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/payroll_mny01_test",
  };
  assert.doesNotThrow(() => assertPaymongoHttpProofTarget(safe));
  for (const change of [{ CI: "false" }, { PAYMONGO_SECRET_KEY: "sk_live_real" }, { PAYMONGO_WALLET_ID: "wallet_real" },
    { PAYMONGO_HTTP_PROOF: "" }, { PAYROLL_PAYOUT_PROVIDER: "xendit" }, { XENDIT_PAYOUTS_ENABLED: "true" }, { RESEND_API_KEY: "x" },
    { DATABASE_URL: "postgresql://postgres:postgres@db.example.com:5432/payroll_mny01_test" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db" }, { MONEY_PROOF_URL: "http://example.com:3011" }]) {
    assert.throws(() => assertPaymongoHttpProofTarget({ ...safe, ...change }), undefined, JSON.stringify(change));
  }
  assert.equal(syntheticPaymongoUrl("https://api.paymongo.com/v2/batch_transfers"), "http://127.0.0.1:3012/v2/batch_transfers");
  for (const url of ["https://api.paymongo.com/v1/payments", "https://evil.example/v2/batch_transfers", "https://api.paymongo.com/v2/wallets/wallet_real"]) {
    assert.throws(() => syntheticPaymongoUrl(url), /forbidden/);
  }
});

test("a refusal must carry the exact status, a JSON error and no forbidden marker", () => {
  const denial = (status, text, headers = []) => ({ status, text, json: JSON.parse(text), headers });
  assert.ok(assertExportsDenial(denial(403, '{"error":"Forbidden"}'), 403, ["VICTIM-NO"]));
  assert.throws(() => assertExportsDenial(denial(200, '{"error":"x"}'), 403, ["VICTIM-NO"]), /incorrect refusal status/);
  assert.throws(() => assertExportsDenial(denial(403, '{"error":"x","who":"VICTIM-NO"}'), 403, ["VICTIM-NO"]), /leaked/);
  assert.throws(() => assertExportsDenial(denial(403, '{"error":"x"}', [["x-run", "VICTIM-NO"]]), 403, ["VICTIM-NO"]), /leaked/);
  assert.throws(() => assertExportsDenial(denial(403, '{"ok":true}'), 403, ["VICTIM-NO"]), /JSON error/);
  assert.throws(() => assertExportsDenial(denial(403, '{"error":"x"}'), 403, [""]), /missing forbidden marker/);
});

test("the synthetic batch must be exactly the own run's single worker, amount, account and idempotency key", () => {
  const post = (change = {}, key = "payroll-run-41") => ({ idempotencyKey: key, payload: { transfers: [{
    reference_number: "PAY-41-EXP-A", amount: 2800000, destination_account: { number: "000000000001" }, ...change }] } });
  const own = { runId: 41, employeeNo: "EXP-A", amountCents: 2800000, account: "000000000001" };
  assert.ok(assertDisbursementPayload(post(), own));
  for (const change of [{ reference_number: "PAY-99-EXP-A" }, { reference_number: "PAY-41-EXP-VICTIM" }, { amount: 1 },
    { destination_account: { number: "999" } }]) {
    assert.throws(() => assertDisbursementPayload(post(change), own), undefined, JSON.stringify(change));
  }
  assert.throws(() => assertDisbursementPayload(post({}, "payroll-run-99"), own), /idempotency/);
  const two = post(); two.payload.transfers.push(two.payload.transfers[0]);
  assert.throws(() => assertDisbursementPayload(two, own), /single worker/);
});

test("snapshots must be byte-identical across every table", () => {
  const before = { payroll_runs: [{ row: { id: 1, status: "Released" } }], audit_events: [] };
  assert.equal(assertRowsUnchanged(before, structuredClone(before), "same"), undefined);
  assert.throws(() => assertRowsUnchanged(before, { ...before, audit_events: [{ row: { id: 9 } }] }, "changed"), /changed/);
  assert.throws(() => assertRowsUnchanged(before, { payroll_runs: before.payroll_runs }, "removed"), /table set changed/);
});

test("the harness proves all three modes for two attackers beside a higher-ID victim on a synthetic provider, and never credits", () => {
  const harness = readFileSync("scripts/qa/tenant-payroll-exports-post-http.mjs", "utf8");
  assert.ok(harness.indexOf("assertPaymongoHttpProofTarget(process.env);") < harness.indexOf('import("../../src/db/index.ts")'),
    "the synthetic-target guard must run before any database import");
  for (const required of [
    'provider.listen(3012, "127.0.0.1"', "sk_test_synthetic_no_network", 'for (let i = 0; i < 7; i++) await seed("PAD" + i);',
    'const v = await seed("VICTIM");', "for (const attacker of [a, b])", "for (const actor of [attacker.owner, attacker.second, attacker.employeeUser])",
    "for (const run of [v.provider, v.manual])", '{ mode: "preflight" }, { mode: "disburse", confirm: true }', 'mode: "complete-manual"',
    "a refusal must never contact the synthetic provider", "another employer's accepted bank validation must not be borrowed",
    "exactly one synthetic batch transfer is created", "a replay must not create a second batch transfer",
    "a manual completion never contacts the provider", "victim after both complete attacker journeys",
    "exactly two synthetic batch transfers in the whole proof", "assertDisbursementPayload(openSubmission.posts[0]",
    "coverageCredits: 0", "independentlyAccepted: false", "realMoneyMoved: false", "knownFindingsNotClosedByThisProof",
  ]) assert.ok(harness.includes(required), "missing harness step " + required);
  assert.doesNotMatch(harness, /\bcoverageCredits: [1-9]/);
  assert.doesNotMatch(harness, /sk_live|api\.paymongo\.com/, "the harness itself never names a live credential or the real provider host");
});

test("the workflow is synthetic-only, holds no secret and runs the contract test and the harness behind the loopback preload", () => {
  const workflow = readFileSync(".github/workflows/tenant-payroll-exports-post-http.yml", "utf8");
  for (const required of [
    "image: postgres:16", "PAYMONGO_HTTP_PROOF: loopback-only", "PAYMONGO_SECRET_KEY: sk_test_synthetic_no_network",
    "PAYMONGO_WALLET_ID: wallet_synthetic", "PAYMONGO_WEBHOOK_SECRET: whsk_synthetic_no_network", "XENDIT_PAYOUTS_ENABLED: 'false'",
    "payroll_mny01_test", "scripts/qa/paymongo-http-proof-preload.mjs", "node --test tests/tenant-payroll-exports-post-contract.test.mjs",
    "npx tsx scripts/qa/tenant-payroll-exports-post-http.mjs", "contents: read", "persist-credentials: false",
    "'src/app/api/payroll-runs/**'", "'src/lib/paymongo-*.ts'", "'src/lib/treasury-controls.ts'",
    'ref: ${{ github.event.pull_request.head.sha }}',
    'EXPECTED_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    'test "$(git rev-parse HEAD)" = "$EXPECTED_HEAD_SHA"',
  ]) assert.ok(workflow.includes(required), "missing workflow content " + required);
  assert.doesNotMatch(workflow, /secrets\./, "no secret may reach a synthetic proof");
});
