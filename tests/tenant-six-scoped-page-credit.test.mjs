import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  TARGETS, selectedTargets, verifySixInputs, verifySixPageCredits,
  expectedSixPageManifest, historicSixPageView, gitBlobSha,
  verifyCurrentScopedPageGapCount
} from "../scripts/qa/tenant-six-scoped-page-credit.mjs";
import { verifyFivePageCredits } from "../scripts/qa/tenant-five-scoped-page-credit.mjs";
import { zeroCreditSsoProofFixture } from "../scripts/qa/payroll-run-sso-proof-fixture.mjs";
import {verifyFourPageCredits, historicFourPageView, expectedFourPageManifest,
  verifyCurrentScopedPageGapCount as verifyFourCurrent} from "../scripts/qa/tenant-four-scoped-page-credit.mjs";

const live = JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
assert.equal(verifyFourPageCredits(live), 4,
  "Six previously accepted pages require every current four-page receipt");
const manifest = historicFourPageView(live);

const fromManifest = m => ({
  covered: m.scopedPages.filter(page => page.status === "COVERED").length,
  gap: m.scopedPages.filter(page => page.status === "GAP").length,
});

test("exact six requested pages have source-sealed fictional PG16 SSR evidence", () => {
  const inputs = verifySixInputs();
  assert.equal(TARGETS.length, 6);
  assert.equal(selectedTargets().length, 6);
  assert.equal(inputs.selected.length, 6);
  assert.equal(verifySixPageCredits(manifest), 6);
  assert.deepEqual(fromManifest(manifest), { covered: 16, gap: 5 });
  assert.equal(manifest.metrics.scopedPagesAndActions, 21);
  assert.equal(manifest.metrics.methods,
    Object.values(manifest.allApiRouteFiles).flatMap(entry => entry.methods).length);
  for (const t of TARGETS) {
    const row = manifest.scopedPages.find(p => p.path === t.path);
    assert.equal(row.status, "COVERED");
    assert.equal(row.blob, t.pageSha);
    assert.equal(gitBlobSha(readFileSync(t.path)), t.pageSha);
    assert.equal(gitBlobSha(readFileSync(t.proof)), t.proofSha);
    assert.equal(gitBlobSha(readFileSync(t.contract)), t.contractSha);
    assert.equal(row.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(row.testedBy?.sourcePageBlobSha, t.pageSha);
    assert.equal(row.testedBy?.proofBlobSha, t.proofSha);
    assert.equal(row.testedBy?.postgresMajor, 16);
    assert.equal(row.testedBy?.actualFinalHeadRunRequired, true);
    assert.equal(row.testedBy?.pageProofStatus, "FINAL_HEAD_CI_REQUIRED");
    assert.equal(row.testedBy?.methodCredits, 0);
    assert.equal(row.testedBy?.independentlyAccepted, false);
    assert.equal(row.testedBy?.productionCertified, false);
    assert.ok(row.testedBy.notTested.length > 20);
    for (const key of [
      "ownPositiveLine", "foreignDenialLine", "unchangedDbLine",
      "forgedSelectorLine", "revokedDenialLine", "victimIdOrderingLine",
    ]) assert.ok(Number.isSafeInteger(row.testedBy[key]) && row.testedBy[key] > 0,
      t.path + ": missing exact-source proof anchor " + key);
  }
});

test("new provisional page generator recomputes live counts without changing 498 methods", () => {
  const expected = expectedSixPageManifest(manifest);
  assert.deepEqual(expected, manifest);
  assert.equal(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"),
    JSON.stringify(expectedFourPageManifest(live), null, 2) + "\n");
  const methods = Object.values(manifest.allApiRouteFiles).flatMap(f => f.methods);
  assert.equal(manifest.metrics.coveredAfter, methods.filter(m => m.status === "COVERED").length);
  assert.equal(manifest.metrics.gap, methods.filter(m => m.status === "GAP").length);
  assert.equal(manifest.metrics.publicByDesign,
    methods.filter(m => m.status === "PUBLIC-BY-DESIGN").length);
  assert.equal(manifest.metrics.privilegedOperationsTokenOnly,
    methods.filter(m => m.status === "PRIVILEGED-OPERATIONS-TOKEN-ONLY").length);
  assert.match(manifest.acceptanceStatus,
    new RegExp("^NOT ACCEPTED: " + manifest.metrics.gap + " API methods and 5 page/action GAPs"));
});

test("the exact historic 10/11 ledger still passes original #1973 proof guards", () => {
  const old = historicSixPageView(manifest);
  assert.deepEqual(fromManifest(old), { covered: 10, gap: 11 });
  assert.equal(verifyFivePageCredits(old), 5);
  assert.deepEqual(old.allApiRouteFiles, manifest.allApiRouteFiles,
    "No new page proof may reclassify API methods");
  const other = new Set(TARGETS.map(p => p.path));
  for (const page of old.scopedPages.filter(p => !other.has(p.path))) {
    assert.deepEqual(page, manifest.scopedPages.find(p => p.path === page.path),
      page.path + " historical source receipt must be identical");
  }
});

test("fail closed when six-page source, proof, classification or totals are altered", () => {
  const corruptions = [
    m => { m.scopedPages.find(p => p.path === TARGETS[0].path).status = "GAP"; },
    m => { delete m.scopedPages.find(p => p.path === TARGETS[1].path).testedBy; },
    m => { m.scopedPages.find(p => p.path === TARGETS[2].path).testedBy.proofBlobSha = "0".repeat(40); },
    m => { m.scopedPages.find(p => p.path === TARGETS[3].path).testedBy.evidenceLabel = "independent"; },
    m => { m.scopedPages.find(p => p.path === TARGETS[4].path).testedBy.previousGapReason = ""; },
    m => { m.scopedPages.find(p => p.path === TARGETS[5].path).testedBy.independentlyAccepted = true; },
    m => { m.metrics.gap--; },
    m => { m.metrics.coveredAfter++; },
    m => { m.scopedPages.push({ path: "src/app/fake/page.tsx", status: "COVERED" }); },
  ];
  for (const mutate of corruptions) {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.throws(() => verifySixPageCredits(changed),
      /SIX_PAGE_REFUSED|FIVE_PAGE_CREDIT_REFUSED|Expected|expected|match|equal|21|11/i);
  }
});

test("SSO zero-credit replay may downgrade exactly 19 API methods, never page evidence", () => {
  const fixture = zeroCreditSsoProofFixture(live);
  assert.deepEqual(fromManifest(live), {covered: 20, gap: 0});
  assert.equal(live.scopedPages.filter(p=>p.status==="PUBLIC-BY-DESIGN").length,1);
  assert.equal(fixture.metrics.gap, live.metrics.gap + 19);
  assert.deepEqual(fixture.scopedPages, live.scopedPages);
  const samlMetadataPath = "src/app/api/auth/saml/metadata/[providerId]/route.ts";
  assert.equal(manifest.allApiRouteFiles[samlMetadataPath].methods[0].status,
    "PUBLIC-BY-DESIGN", "Approved public SAML metadata must remain independently classified");
  assert.deepEqual(fixture.allApiRouteFiles[samlMetadataPath],
    manifest.allApiRouteFiles[samlMetadataPath],
    "The 19-method SSO replay must not demote or alter the reviewed SAML metadata contract");
  const prior = {
    CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
    TENANT_SECOND_PASS_MODE: process.env.TENANT_SECOND_PASS_MODE
  };
  process.env.CI = "true";
  process.env.GITHUB_ACTIONS = "true";
  process.env.TENANT_SECOND_PASS_MODE = "isolated-ci-only";
  try {
    assert.equal(verifyFourCurrent(fixture), 0,
      "Exact withdrawn-method fixture must retain all ten separately proven page credits");
    const altered = structuredClone(fixture);
    altered.scopedPages[0].reason += " TEST-TAMPER";
    assert.throws(() => verifyFourCurrent(altered),
      /FOUR_PAGE_REFUSED|SIX_PAGE_REFUSED|AssertionError/,
      "Any changed page evidence must be refused even in the SSO fixture");
    const alteredMethod = structuredClone(fixture);
    alteredMethod.allApiRouteFiles["src/app/api/marketing/leads/route.ts"].methods[0].status = "GAP";
    assert.throws(() => verifyFourCurrent(alteredMethod),
      /FOUR_PAGE_REFUSED|SIX_PAGE_REFUSED|AssertionError/,
      "The fixture must not be used to downgrade unreviewed API methods");
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
