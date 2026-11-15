import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  TARGETS, MANIFEST, WORKFLOW, selectedTargets, verifyFourInputs,
  expectedFourPageManifest, historicFourPageView, verifyFourPageCredits,
  verifyCurrentScopedPageGapCount
} from "../scripts/qa/tenant-four-scoped-page-credit.mjs";
import {verifyFivePageCredits, historicWorker360ProofView} from
  "../scripts/qa/tenant-five-scoped-page-credit.mjs";
import {verifyWorker360PageCredit} from
  "../scripts/qa/tenant-five-method-credit-verify.mjs";

const read = path => readFileSync(path, "utf8");
const live = JSON.parse(read(MANIFEST));
const historic = () => historicFourPageView(live);
const counts = m => ({
  covered: m.scopedPages.filter(p => p.status === "COVERED").length,
  gap: m.scopedPages.filter(p => p.status === "GAP").length,
});
test("all selected proof sources/contract blobs, four assertion anchors and safe exact-head workflow are sealed", () => {
  assert.equal(TARGETS.length, 4);
  assert.equal(selectedTargets().length, 4);
  const {selected, anchors} = verifyFourInputs();
  assert.equal(selected.length, 4);
  for (const item of selected) {
    const row = live.scopedPages.find(p => p.path === item.path);
    assert.equal(row?.status, "COVERED");
    assert.equal(row.blob, item.sha);
    assert.deepEqual(row.testedBy.sourcePageBlobSha, item.sha);
    assert.deepEqual(row.testedBy.proofBlobSha, item.proofSha);
    assert.deepEqual(row.testedBy.contractBlobSha, item.contractSha);
    assert.deepEqual(anchors.get(item.key).length, 6);
    assert.equal(row.testedBy.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(row.testedBy.independentlyAccepted, false);
    assert.equal(row.testedBy.productionCertified, false);
    assert.equal(row.testedBy.methodCredits, 0);
  }
  const wf = read(WORKFLOW);
  assert.match(wf, /fail-fast: false/);
  assert.match(wf, /image: postgres:16/);
  assert.match(wf, /needs: \[page-http-reproof\]/);
  assert.match(wf, /family:"ess-page"/);
  assert.match(wf, /family:"ess-receipts"/);
  assert.match(wf, /git fetch --no-tags origin main/);
});
test("new page-only ledger is generator-exact, no historical or API status changes", () => {
  assert.equal(verifyFourPageCredits(live), selectedTargets().length);
  assert.equal(read(MANIFEST), JSON.stringify(expectedFourPageManifest(live), null, 2) + "\n");
  const original = historic();
  assert.equal(verifyFivePageCredits(original), 5);
  assert.equal(verifyWorker360PageCredit(historicWorker360ProofView(original)), 16);
  assert.equal(counts(live).covered, counts(original).covered + selectedTargets().length);
  assert.equal(counts(live).gap, counts(original).gap - selectedTargets().length);
  assert.equal(counts(live).covered + counts(live).gap, 21);
  assert.equal(original.scopedPages.length, 21);
  assert.deepEqual(live.allApiRouteFiles, original.allApiRouteFiles,
    "No API method, history, tax, payment, payout or token-only credit may change");
  assert.deepEqual(live.scopedRedirectAliases, original.scopedRedirectAliases);
  assert.deepEqual(live.sourceTraceCandidates, original.sourceTraceCandidates);
  assert.deepEqual(live.proofPolicy, original.proofPolicy);
  const selected = new Set(selectedTargets().map(t => t.path));
  for (const p of original.scopedPages.filter(p => !selected.has(p.path))) {
    assert.deepEqual(live.scopedPages.find(row => row.path === p.path), p,
      "Unrelated page/receipt changed: " + p.path);
  }
  assert.equal(verifyCurrentScopedPageGapCount(live), counts(live).gap);
  assert.equal(verifyCurrentScopedPageGapCount(original), counts(original).gap);
  assert.match(live.acceptanceStatus, /^NOT ACCEPTED:/);
});
test("ESS promotion needs both original feature-on SSR and augmented two-attacker receipt API", () => {
  const entry = live.scopedPages.find(row => row.path === "src/app/self/schedule-receipts/page.tsx");
  assert.equal(entry?.status, "COVERED");
  assert.equal(entry.testedBy.companionReceiptProof, "scripts/qa/tenant-four-ess-receipts-http.mjs");
  const extra = read(entry.testedBy.companionReceiptProof);
  assert.match(extra, /assert\.equal\(peerRows\.length, 1/);
  assert.match(extra, /await post\(actor\.peer/);
  assert.match(extra, /colleagueSelector\.json, unknownSelector\.json/);
  assert.match(extra, /victimSelector\.json, unknownSelector\.json/);
  assert.match(extra, /assertUnchanged\(victimBefore, await snapshot\(victim\.org\.id\)/);
  assert.equal(historic().scopedPages.find(row => row.path === entry.path).status, "GAP");
});
test("fail closed on false/foreign page credits and mutation of receipt/provenance/metrics", () => {
  const mutators = [
    m => {m.scopedPages.find(p => p.path === TARGETS[0].path).status = "GAP";},
    m => {delete m.scopedPages.find(p => p.path === TARGETS[1].path).testedBy;},
    m => {m.scopedPages.find(p => p.path === TARGETS[2].path).testedBy.proofBlobSha = "0".repeat(40);},
    m => {m.scopedPages.find(p => p.path === TARGETS[3].path).testedBy.companionReceiptProofSha = "0".repeat(40);},
    m => {m.scopedPages.find(p => p.path === TARGETS[0].path).testedBy.evidenceLabel = "independent";},
    m => {m.scopedPages.find(p => p.path === TARGETS[1].path).testedBy.independentlyAccepted = true;},
    m => {m.scopedPages.find(p => p.path === TARGETS[2].path).reason = "credit without proof";},
    m => {m.scopedPages.find(p => p.path === "src/app/careers/page.tsx").status = "COVERED";},
    m => {m.metrics.gap++;},
    m => {m.metrics.coveredAfter++;},
    m => {m.scopedPages.push({path:"src/app/fake/page.tsx",status:"COVERED"});},
  ];
  for (const mutation of mutators) {
    const changed = structuredClone(live);
    mutation(changed);
    assert.throws(() => verifyFourPageCredits(changed),
      /FOUR_PAGE_REFUSED|FIVE_PAGE_CREDIT_REFUSED|expected|Expected|strict|GAP|21/i);
  }
});