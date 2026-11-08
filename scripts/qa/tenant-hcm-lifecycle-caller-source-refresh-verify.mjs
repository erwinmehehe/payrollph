/**
 * One strictly bounded historic HMO/HCM caller refresh. This does not certify
 * the separate lifecycle audit-veto test, extend original test coverage or
 * permit merging while independent security review is PENDING.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const HCM_ROUTE = "src/app/api/hcm/lifecycle-notifications/route.ts";
export const OLD_HCM_SHA = "313428af8364c07b38010b5871a5b7f1d5246511";
export const CURRENT_HCM_SHA = "2ad17eb7fe188c72b9c11e0a094d01870adcc921";
export const CURRENT_REPROOF = "scripts/qa/tenant-hcm-lifecycle-caller-source-refresh.json";
const EXPECTED = {
  "kind": "SOURCE_CURRENT_DOCUMENT_CALLER_REPROOF",
  "historicalReceiptSha256": "aee9a88d62b4fa68efd1ab61eb66343218a77532467a9cc28654f19bb833d91e",
  "historicalRouteBlobSha": "313428af8364c07b38010b5871a5b7f1d5246511",
  "currentRouteBlobSha": "2ad17eb7fe188c72b9c11e0a094d01870adcc921",
  "newReaderBlobSha": "d9987747f955f2f2df534296da3b0b2631cf4ae8",
  "runnerBlobSha": "b16ba054ce6d2fd4cb5d1278604a120f9dfb7ea5",
  "queueSuiteBlobSha": "5d3710f91b0e5d6b06010102566141beba86ca1d",
  "workflowBlobSha": "167e4466f4f003328308bf430a249960b9a35442",
  "sourceHead": "81fc9fe54d8485780f46fb0bb2529d6ca592fc11",
  "run": 42493142487,
  "job": 128769634350,
  "jobConclusion": "success",
  "evidence": "https://github.com/erwinmehehe/payrollph/actions/runs/42493142487/job/128769634350",
  "result": {
    "kind": "DOCUMENT_CALLER_REPROOF",
    "label": "SOLO_VERIFIED_DEV_RECOVERY",
    "result": "PASS",
    "employers": 3,
    "attackers": 2,
    "credits": 0,
    "productionCertified": false,
    "providerCalls": 0
  },
  "scope": "Historical HMO and HCM queue caller assertions re-executed on exact new HCM route; not the separate atomic-audit-veto proof",
  "credits": 0,
  "productionCertified": false,
  "independentSecurityReview": "PENDING",
  "auditVetoReview": "PENDING"
};
const PINS = Object.freeze({
  [HCM_ROUTE]: CURRENT_HCM_SHA,
  "src/lib/hcm-lifecycle-notification-tenant.ts": EXPECTED.newReaderBlobSha,
  "scripts/qa/tenant-document-caller-reproof-http.mjs": EXPECTED.runnerBlobSha,
  "scripts/qa/hcm-work-queue-http.mjs": EXPECTED.queueSuiteBlobSha,
  ".github/workflows/tenant-hcm-lifecycle-boundary-http.yml": EXPECTED.workflowBlobSha,
});

function blob(raw) {
  const bytes = Buffer.from(String(raw).replaceAll("\r\n", "\n"));
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

export function verifyCurrentHcmCallerReproof(read = readFileSync) {
  const raw = read(CURRENT_REPROOF, "utf8");
  // Pin the exact receipt bytes, not merely the parsed JSON. Even whitespace
  // mutations of an executed CI evidence record invalidate this attestation.
  assert.equal(blob(raw), "6e811217b10f0d1e1aeccdcfe536b7c51b444e8e",
    "Executed HCM caller refresh receipt bytes changed");
  const receipt = JSON.parse(raw);
  assert.deepEqual(receipt, EXPECTED,
    "Only the independently observed, successful exact-source HCM caller job may replace its own old source pin");
  assert.equal(receipt.historicalRouteBlobSha, OLD_HCM_SHA);
  assert.equal(receipt.currentRouteBlobSha, CURRENT_HCM_SHA);
  assert.equal(receipt.result.credits, 0);
  assert.equal(receipt.productionCertified, false);
  assert.equal(receipt.independentSecurityReview, "PENDING");
  assert.equal(receipt.auditVetoReview, "PENDING");
  for (const [path, sha] of Object.entries(PINS)) {
    assert.equal(blob(read(path, "utf8")), sha,
      "Source-current HCM caller proof drifted: " + path);
  }
  return receipt;
}
