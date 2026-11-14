import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { historicOidcBatchView, verifyOidcBatchCredits } from "../scripts/qa/tenant-oidc-batch-credit-verify.mjs";
import {
  TARGETS, verifyFivePageProofInputs, verifyFivePageCredits,
  expectedFivePageCreditManifest, gitBlobSha,
  historicWorker360ProofView, verifyCurrentScopedPageGapCount,
} from "../scripts/qa/tenant-five-scoped-page-credit.mjs";
import { assertMkt01Receipt } from "../scripts/qa/tenant-mkt01-marketing-credit.mjs";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";

const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const copy = () => structuredClone(m);

test("five page-only credits preserve the API ledger; only separately proved MKT-01 may reduce its GAP", () => {
  assert.equal(verifyFivePageProofInputs(), true);
  assert.equal(verifyFivePageCredits(m), 5);
  assert.equal(m.scopedPages.length, 21);
  assert.equal(m.scopedPages.filter(x => x.status === "COVERED").length, 10);
  assert.equal(m.scopedPages.filter(x => x.status === "GAP").length, 11);
  assert.equal(m.metrics.methods, Object.values(m.allApiRouteFiles).flatMap(file => file.methods).length);
  // #1973 credits five pages only. PR #1976 independently credits one
  // operator-scoped marketing GET, never a tenant-private page or a second API.
  const marketingGet = m.allApiRouteFiles["src/app/api/marketing/leads/route.ts"]?.methods
    .find(method => method.name === "GET");
  assert.equal(marketingGet?.status, "COVERED", "Only the reviewed operator-only MKT-01 GET may receive its separate method credit");
  assert.equal(assertMkt01Receipt(m), 1, "MKT-01 needs its exact source-pinned PG16 receipt");
  assert.equal(verifyOidcBatchCredits(m), 2, "Require both independent OIDC source-verified receipts");
  assert.equal(historicOidcBatchView(m).metrics.gap, m.metrics.gap + 2,
    "Historical page accounting withdraws precisely the two OIDC method credits");
  // Live method classifications must be tallied rather than frozen to a
  // historical main-branch count. The page generator and MKT-01 verifier
  // independently reject any unrelated API or page promotion.
  assertLiveTenantCounts(assert, m);
  assert.equal(m.metrics.scopedPagesAndActions, 21);
  assert.deepEqual(TARGETS.map(x => x.path), [
    "src/app/app/engagement/page.tsx",
    "src/app/app/goals-reviews/page.tsx",
    "src/app/hcm/my-team/page.tsx",
    "src/app/hcm/team-leave-calendar/page.tsx",
    "src/app/hcm/work-items/page.tsx",
  ]);
  for (const spec of TARGETS) {
    const p = m.scopedPages.find(x => x.path === spec.path);
    assert.equal(p.status, "COVERED");
    assert.equal(p.blob, spec.sha);
    assert.equal(gitBlobSha(readFileSync(p.path)), spec.sha);
    assert.equal(p.testedBy?.proofBlobSha, spec.proofSha);
    assert.equal(p.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(p.testedBy?.independentlyAccepted, false);
    assert.equal(p.testedBy?.actualFinalHeadRunRequired, true);
    assert.equal(p.testedBy?.methodCredits, 0);
  }
});

test("generator re-computation is byte-identical and does not touch unrelated ledger fields", () => {
  const normalized = JSON.stringify(expectedFivePageCreditManifest(m), null, 2) + "\n";
  assert.equal(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"), normalized);
  assert.equal(m.metrics.routeFiles, Object.keys(m.allApiRouteFiles).length);
  const methods = Object.values(m.allApiRouteFiles).flatMap(f => f.methods);
  assert.equal(m.metrics.coveredAfter, methods.filter(x => x.status === "COVERED").length);
  assert.equal(m.metrics.gap, methods.filter(x => x.status === "GAP").length);
  assert.match(m.acceptanceStatus, new RegExp("^NOT ACCEPTED: " + m.metrics.gap +
    " API methods and 11 page/action GAPs"));
});

test("never accept a missing, retagged, forged or unpinned page receipt", () => {
  for (const mutate of [
    x => { x.scopedPages.find(p => p.path === TARGETS[0].path).status = "GAP"; },
    x => { x.scopedPages.find(p => p.path === TARGETS[1].path).testedBy = undefined; },
    x => { x.scopedPages.find(p => p.path === TARGETS[2].path).testedBy.evidenceLabel = "independent"; },
    x => { x.scopedPages.find(p => p.path === TARGETS[3].path).testedBy.proofBlobSha = "0".repeat(40); },
    x => { x.scopedPages.find(p => p.path === TARGETS[4].path).testedBy.notTested = ""; },
    x => { x.metrics.coveredAfter++; },
    x => { x.metrics.gap--; },
    x => { x.scopedPages.push({ path: "src/app/unreviewed/page.tsx", status: "COVERED" }); },
  ]) {
    const x = copy(); mutate(x);
    assert.throws(() => verifyFivePageCredits(x), /FIVE_PAGE_CREDIT_REFUSED|Failed|Expected|unexpected|exact|only|21|10|11/i);
  }
});

test("page probes preserve original Worker 360 checks while accepting exactly five verified new pages", () => {
  assert.equal(verifyCurrentScopedPageGapCount(m), 11);
  const original = historicWorker360ProofView(m);
  assert.equal(verifyCurrentScopedPageGapCount(original), 16);
  const noWorker360 = structuredClone(original);
  noWorker360.scopedPages.find(p => p.path === "src/app/hcm/worker-360/page.tsx").status = "GAP";
  assert.throws(() => verifyCurrentScopedPageGapCount(noWorker360), /Only Worker 360|Only this Worker 360|GAP|expected|Expected|worker/i);
  for (const mutate of [
    x => { x.scopedPages.find(p => p.path === TARGETS[0].path).testedBy = null; },
    x => { x.scopedPages.find(p => p.path === TARGETS[1].path).testedBy.proofBlobSha = "0".repeat(40); },
    x => { x.scopedPages.find(p => p.path === TARGETS[2].path).status = "GAP"; },
    x => { x.scopedPages.find(p => p.path === TARGETS[3].path).testedBy.independentlyAccepted = true; },
  ]) {
    const corrupted = copy(); mutate(corrupted);
    assert.throws(() => verifyCurrentScopedPageGapCount(corrupted),
      /FIVE_PAGE_CREDIT_REFUSED|SCOPED_PAGE_REFUSED|Worker 360|GAP|Expected|expected/i);
  }
});
