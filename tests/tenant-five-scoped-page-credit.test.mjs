import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TARGETS, verifyFivePageProofInputs, verifyFivePageCredits,
  expectedFivePageCreditManifest, gitBlobSha,
} from "../scripts/qa/tenant-five-scoped-page-credit.mjs";

const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const copy = () => structuredClone(m);

test("only five named original GAP pages are source-current credited; all APIs unchanged", () => {
  assert.equal(verifyFivePageProofInputs(), true);
  assert.equal(verifyFivePageCredits(m), 5);
  assert.equal(m.scopedPages.length, 21);
  assert.equal(m.scopedPages.filter(x => x.status === "COVERED").length, 10);
  assert.equal(m.scopedPages.filter(x => x.status === "GAP").length, 11);
  assert.equal(m.metrics.methods, 498);
  assert.equal(m.metrics.gap, 5);
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
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED: 5 API methods and 11 page\/action GAPs/);
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
