import assert from "node:assert/strict";
import { requireDisposablePiiApprovalEnv } from "./tenant-pii01-approval-contract.mjs";

export function requireExportProof(env = process.env) {
  requireDisposablePiiApprovalEnv(env);
  assert.equal(env.TENANT_COMPANY_EXPORT_MODE, "fictional-ci-only");
  assert.ok(["true", "false"].includes(env.MULTI_ENTITY_ENABLED));
  for (const key of ["MALWARE_SCAN_URL", "MALWARE_SCAN_TOKEN", "DOCUMENT_OBJECT_STORAGE_ENDPOINT", "OPENAI_API_KEY"])
    assert.ok(!env[key], "EXPORT_PROOF_REFUSED: " + key);
}

export function proveEmployeeExport(response, own, excluded) {
  assert.equal(response.status, 200);
  assert.match(response.type, /^text\/csv/);
  assert.match(response.cache, /private/);
  assert.match(response.cache, /no-store/);
  assert.equal(response.nosniff, "nosniff");
  assert.ok(response.text.includes(own), "missing genuine own employee");
  assert.ok(!response.text.includes(excluded), "accepts another employer's data");
}
