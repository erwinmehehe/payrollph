import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { requireReceiptProof, assertReceiptBytes } from "../scripts/qa/receipt-http-proof-contract.mjs";

const safe = { CI: "true", GITHUB_ACTIONS: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only", REQUIRE_PRIVILEGED_MFA: "true",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000", NODE_ENV: "production", DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db", PII_ENCRYPTION_KEY: "1".repeat(64),
  RECEIPT_HTTP_PROOF_MODE: "fictional-ci-only", DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://127.0.0.1:9443/",
  DOCUMENT_OBJECT_STORAGE_BUCKET: "fictional-receipts", DOCUMENT_OBJECT_STORAGE_REGION: "us-east-1",
  DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "fictional-receipt-key", DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "fictional-receipt-secret",
  MALWARE_SCAN_URL: "https://127.0.0.1:9443/scan", MALWARE_SCAN_TOKEN: "fictional-receipt-scanner",
  SPEND_PAYROLL_REIMBURSEMENTS_ENABLED: "true", EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true", DOCUMENT_UPLOADS_ENABLED: "true",
  MULTI_ENTITY_ENABLED: "false", NODE_EXTRA_CA_CERTS: "/tmp/disposable-receipt.crt",
};
test("receipt proof refuses non-CI, remote storage/scanner, real secrets and TLS verification bypass", () => {
  assert.doesNotThrow(() => requireReceiptProof(safe));
  for (const change of [{ CI: "false" }, { DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://production.invalid/" },
    { MALWARE_SCAN_URL: "https://scanner.invalid/scan" }, { DATABASE_URL: "postgresql://remote.invalid/app_db" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { NODE_EXTRA_CA_CERTS: "" }, { RESEND_API_KEY: "forbidden" }]) {
    assert.throws(() => requireReceiptProof({ ...safe, ...change }));
  }
});
test("a 200 HTML/foreign/corrupt receipt cannot pass the own-byte privacy proof", () => {
  const receipt = { status: 200, bytes: Buffer.from("own"), cache: "private, no-store" };
  assert.doesNotThrow(() => assertReceiptBytes(receipt, Buffer.from("own"), "own"));
  for (const bytes of [Buffer.from("foreign"), Buffer.from("<html>Sign in</html>"), Buffer.alloc(0)]) {
    assert.throws(() => assertReceiptBytes({ ...receipt, bytes }, Buffer.from("own"), "own"), /accepts another employer's data/);
  }
  assert.throws(() => assertReceiptBytes({ ...receipt, cache: "public" }, Buffer.from("own"), "own"));
});
test("receipt acceptance is a guarded dedicated workflow with zero credits and TLS kept enabled", () => {
  const runner = readFileSync("scripts/qa/tenant-receipt-boundary-http.mjs", "utf8");
  assert.ok(runner.indexOf("requireReceiptProof();") < runner.indexOf('import("../../src/db/index.ts")'));
  for (const text of ["for (const f of [a, b])", "v.claim.id > 6", "real readback race not exercised", "newCoverageCredits: 0", "victimBefore"]) assert.ok(runner.includes(text));
  const workflow = readFileSync(".github/workflows/tenant-receipt-boundary-http.yml", "utf8");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-receipt-boundary-http.mjs"));
  assert.ok(workflow.includes("--cacert")); assert.ok(!workflow.includes("secrets."));
  assert.ok(!workflow.includes("NODE_TLS_REJECT_UNAUTHORIZED"));
});
