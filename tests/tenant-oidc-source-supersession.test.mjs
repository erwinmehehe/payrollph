/** Mutation checks for precisely scoped callback source withdrawal; no credentials/DB. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {historicOidcBatchView} from '../scripts/qa/tenant-oidc-batch-credit.mjs';
import {
  OIDC_CALLBACK, verifyOidcCallbackHold, verifyOidcHistoricalReceipt,
} from "../scripts/qa/tenant-oidc-source-supersession.mjs";
const manifest = () => historicOidcBatchView(JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8")));
const changed = mutate => {
  const m = manifest();
  mutate(m.allApiRouteFiles[OIDC_CALLBACK].methods[0], m);
  assert.throws(() => verifyOidcCallbackHold(m));
};
test("only exact default-OFF callback zero-credit hold is recognized", () => {
  const m = manifest();
  assert.equal(verifyOidcCallbackHold(m), 0);
  const row = m.allApiRouteFiles[OIDC_CALLBACK].methods[0];
  assert.equal(row.status, "GAP");
  assert.equal(row.testedBy, null);
  const receipt = verifyOidcHistoricalReceipt();
  assert.equal(receipt.coverageCredits, 0);
  assert.equal(receipt.productionCertified, false);
});
test("SSO source withdrawal cannot silently promote or accept a method", () => {
  changed(row => { row.status = "COVERED"; });
  changed(row => { row.testedBy = { file: "scripts/qa/tenant-oidc-full-http.mjs" }; });
  changed(row => { row.reviewedUncertified.credits = 1; });
  changed(row => { row.reviewedUncertified.exactHeadPg16Http = "PASS"; });
  changed(row => { row.reviewedUncertified.linkedIdentityBoundary.priorProofSuperseded = false; });
  changed(row => { row.reviewedUncertified.linkedIdentityBoundary.productionCertified = true; });
  changed((row, m) => { m.allApiRouteFiles[OIDC_CALLBACK].gitBlobSha = "0".repeat(40); });
});
test("callback/policy byte drift or edited old receipts invalidates the hold", () => {
  const m = manifest();
  const src = readFileSync(OIDC_CALLBACK, "utf8");
  const patched = file => file === OIDC_CALLBACK
    ? src.replace("if (!oidcSsoRuntimeEnabled()) return oidcSsoDisabledResponse();",
      "if (false) return oidcSsoDisabledResponse();")
    : readFileSync(file);
  assert.throws(() => verifyOidcCallbackHold(m, patched), /source changed/);
  const receipt = "scripts/qa/tenant-oidc-full-renewal-receipt.json";
  assert.throws(() => verifyOidcHistoricalReceipt((file, ...args) =>
    file === receipt ? readFileSync(file, ...args) + "\n" : readFileSync(file, ...args)),
  /receipt changed/);
});
