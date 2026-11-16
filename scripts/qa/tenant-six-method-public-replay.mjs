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
// Only the two narrowly reviewed source-test changes are permitted on the PR
// head: (a) verified in-memory wage-source historical view for current GAPs,
// (b) one already owner-approved SSO public label in the main-ledger model.
// Every other historical assertion, receipt and exact source pin stays intact.
const importLine = 'import { verifySixPageCredits, historicSixPageView, selectedTargets } from "../scripts/qa/tenant-six-scoped-page-credit.mjs";';
const historicalLine = "const m = historicSixPageView(live);";
assert.equal(archived.split(importLine).length - 1, 1);
assert.equal(archived.split(historicalLine).length - 1, 1);
const projectedHead = archived
  .replace(importLine, importLine + '\n' +
    'import { historicWageRegistryProofView } from "../scripts/qa/wage-registry-source-hold.mjs";')
  .replace(historicalLine,
    '// Validate the LIVE 23 + 47 + 5 GAP/HELD entries first, then replay only\n' +
    '// immutable historical receipts in memory. No production/current credit returns.\n' +
    'const m = historicWageRegistryProofView(historicSixPageView(live));');

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
  "    // Current main has exactly one owner-approved, zero-credit public SSO relabel.\n" +
  "    const baselineSsoPublic = baseline.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0].status==='PUBLIC-BY-DESIGN'\n" +
  "      ? verifySsoResolveClassification(baseline, readMainSource) : 0;\n" +
  "    if (baselineSsoPublic) expectedOriginalMain[SSO_RESOLVE_PATH].POST='PUBLIC-BY-DESIGN';\n";
const patched = archived
  .replace(marker, extension + marker)
  .replaceAll(before, '(baselinePublicReclassifications + baselineSamlPublic + baselineSsoPublic)');
const expectedHead = projectedHead
  .replace(marker, extension + marker)
  .replaceAll(before, '(baselinePublicReclassifications + baselineSamlPublic + baselineSsoPublic)');
assert.equal(branch, expectedHead,
  "Only explicit historic wage-source projection and authenticated public SSO relabel may change six-method PR-head tests");
assert.notEqual(patched, archived);
assert.equal(patched.split("verifySsoResolveClassification(baseline, readMainSource)").length - 1, 1);
writeFileSync(resolve(historical, testPath), patched, "utf8");
console.log(JSON.stringify({
  kind: "HISTORICAL_SIX_METHOD_SOURCE_COMPAT",
  verifiedPublicMethods: 1, addedTenantCredits: 0,
  historicalReceiptsChanged: false, currentWageSourceApproved: false,
  localTemporaryTestOnly: true,
}));
