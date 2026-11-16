/**
 * Source-only reconciliation for the historical six-method PR-base replay.
 * The old test/receipts are immutable. The sole permissible temporary test
 * amendment is an owner-approved, zero-credit PUBLIC-BY-DESIGN classification
 * of POST auth/sso/resolve, which main adopted after that test was written.
 * Never use this for source-current tenant/payroll certification.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const historical = process.argv[2];
if (typeof historical !== "string" || !historical.includes("six-method-historical.")) {
  throw new Error("Only a disposable detached six-method historical worktree is allowed");
}
const testPath = "tests/tenant-six-method-proof-review.test.mjs";
const archived = readFileSync(resolve(historical, testPath), "utf8");
const branch = readFileSync(testPath, "utf8");
assert.equal(branch, archived, "Historical six-method test source must stay byte-identical to PR base");
const baseManifest = JSON.parse(readFileSync(resolve(historical,
  "scripts/qa/tenant-isolation-coverage-manifest.json"), "utf8"));
const sso = baseManifest.allApiRouteFiles?.["src/app/api/auth/sso/resolve/route.ts"];
assert.equal(sso?.gitBlobSha, "d9366bd1fe6cb4bf00e33b166969cd1dfc8b0299");
assert.equal(sso?.methods?.length, 1);
assert.equal(sso.methods[0].name, "POST");
assert.equal(sso.methods[0].status, "PUBLIC-BY-DESIGN",
  "Replay is permitted only for the one already approved public SSO classification");
assert.equal(sso.methods[0].testedBy, null, "No tenant-private method credit is authorized");
assert.equal(sso.methods[0].classificationEvidence?.coverageCredits, 0);
assert.equal(sso.methods[0].classificationEvidence?.productionCertified, false);
const marker = '    assert.deepEqual(methodStatuses(baseline), expectedOriginalMain,';
const before = '(baselinePublicReclassifications + baselineSamlPublic)';
const occurrences = archived.split(before).length - 1;
assert.equal(archived.split(marker).length - 1, 1, "Exact historical main-ledger invariant required");
assert.equal(occurrences, 8, "Only eight documented frozen/main subtotal expressions may change");
const extension =
  "    // Exact main-only one-method public classification, with original owner and PG16 receipt proof.\\n" +
  "    const baselineSsoPublic = baseline.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0].status==='PUBLIC-BY-DESIGN'\\n" +
  "      ? verifySsoResolveClassification(baseline, readMainSource) : 0;\\n" +
  "    if (baselineSsoPublic) expectedOriginalMain[SSO_RESOLVE_PATH].POST='PUBLIC-BY-DESIGN';\\n";
const patched = archived
  .replace(marker, extension + marker)
  .replaceAll(before, '(baselinePublicReclassifications + baselineSamlPublic + baselineSsoPublic)');
assert.notEqual(patched, archived);
assert.equal(patched.split("verifySsoResolveClassification(baseline, readMainSource)").length - 1, 1);
writeFileSync(resolve(historical, testPath), patched, "utf8");
console.log(JSON.stringify({
  kind: "HISTORICAL_SIX_METHOD_SOURCE_COMPAT",
  verifiedPublicMethods: 1, addedTenantCredits: 0,
  historicalReceiptsChanged: false, currentWageSourceApproved: false,
  localTemporaryTestOnly: true,
}));
