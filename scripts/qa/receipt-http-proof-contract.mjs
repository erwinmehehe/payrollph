import assert from "node:assert/strict";
import { requireDisposablePiiApprovalEnv } from "./tenant-pii01-approval-contract.mjs";

export function requireReceiptProof(env = process.env) {
  requireDisposablePiiApprovalEnv(env);
  for (const [key, value] of Object.entries({
    RECEIPT_HTTP_PROOF_MODE: "fictional-ci-only",
    DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://127.0.0.1:9443/",
    DOCUMENT_OBJECT_STORAGE_BUCKET: "fictional-receipts",
    DOCUMENT_OBJECT_STORAGE_REGION: "us-east-1",
    DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "fictional-receipt-key",
    DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "fictional-receipt-secret",
    MALWARE_SCAN_URL: "https://127.0.0.1:9443/scan",
    MALWARE_SCAN_TOKEN: "fictional-receipt-scanner",
    SPEND_PAYROLL_REIMBURSEMENTS_ENABLED: "true",
    EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true",
    DOCUMENT_UPLOADS_ENABLED: "true", MULTI_ENTITY_ENABLED: "false",
  })) assert.equal(env[key], value, "RECEIPT_PROOF_REFUSED: " + key);
  assert.ok(env.NODE_EXTRA_CA_CERTS, "verified disposable CA required");
  assert.ok(!env.NODE_TLS_REJECT_UNAUTHORIZED, "TLS verification must not be disabled");
}

export function assertReceiptBytes(receipt, expected, label) {
  assert.equal(receipt.status, 200, label + ": own bytes unavailable");
  assert.deepEqual(receipt.bytes, expected, label + ": accepts another employer's data");
  assert.match(receipt.cache ?? "", /private/);
  assert.match(receipt.cache ?? "", /no-store/);
}
