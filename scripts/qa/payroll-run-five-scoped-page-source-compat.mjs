/**
 * Source-only equivalence for five additional *page-only* tenant proof candidates.
 *
 * The sealed second-pass payroll renewal still refers to the historical
 * tenant-scoped-page-probes.mjs SHA. This narrowly reviewed change replaces
 * exactly one page-count assertion so the exploratory probe can demand the
 * new five-page receipt verifier. It MUST NOT weaken HTTP denial assertions,
 * modify historical payroll receipts or grant API-method credit.
 *
 * The scoped page claim is still conditional on final-head fictional PG16
 * jobs; this compatibility review is not an execution receipt.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renewalBlob } from "./payroll-run-renewal-inputs.mjs";

const PROBE = "scripts/qa/tenant-scoped-page-probes.mjs";
const GENERATOR = "scripts/qa/tenant-five-scoped-page-credit.mjs";
const WORKFLOW = ".github/workflows/tenant-five-scoped-pages-credit.yml";
const WORKER_VERIFIER = "scripts/qa/tenant-five-method-credit-verify.mjs";
const HISTORICAL_PROBE_BLOB = "fe310ca93f2d6ae2fd48ce72d2ee1cf451b55e20";
const REVIEWED_PROBE_BLOB = "48a62c81c7d20b1d6980e2f9d610bbb9afdb7173";
const REVIEWED_GENERATOR_BLOB = "08335292d7534ac3618f59b6959bbd8133483dd7";
const REVIEWED_WORKFLOW_BLOB = "4d475e51c601583ba4212e2c327207c5bb1b34dc";
const HISTORICAL_WORKER_VERIFIER_BLOB = "8b9b1cdee7ff5228a5558f2e326dff6019f19e8b";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";

const ORIGINAL = '  assert.equal(pageGaps.length, (await import("./tenant-five-method-credit-verify.mjs")).verifyWorker360PageCredit(manifest), "Worker 360 SSR gap reduction requires source-pinned PG16 and review proof");';
const REVISED = '  assert.equal(pageGaps.length, (await import("./tenant-five-scoped-page-credit.mjs")).verifyCurrentScopedPageGapCount(manifest), "Scoped page GAP reduction requires the five exact-source proofs and original Worker 360 verification");';

const REVIEWED_PAGES = Object.freeze([
  ["src/app/app/engagement/page.tsx", "6e84c87f63816042a847e4fbccfd970b84ceffa3", "scripts/qa/tenant-people-pages-http.mjs", "fad1f0ad45d41d158cee968e7b9de0188ed9030e"],
  ["src/app/app/goals-reviews/page.tsx", "13cc6239921d740cf984066e3cf716f752ec1371", "scripts/qa/tenant-people-pages-http.mjs", "fad1f0ad45d41d158cee968e7b9de0188ed9030e"],
  ["src/app/hcm/my-team/page.tsx", "8f7386f007b7a498777ba2549d5fec27e3dd69b8", "scripts/qa/tenant-hcm-my-team-http.mjs", "4d1edcf75fa0c4ce0206234fa474d7ea33d3e766"],
  ["src/app/hcm/team-leave-calendar/page.tsx", "bcf78f9ebc733ee6236852960eb46e32c020e272", "scripts/qa/tenant-team-leave-http.mjs", "865f9aba100d60646f2fcdbce64aef40a6f34659"],
  ["src/app/hcm/work-items/page.tsx", "1452c03d1a89fe599dda1c8b72edcfcaf67d75ef", "scripts/qa/tenant-five-page-work-items-http.mjs", "0cbd02f7a23388bd70277717ecd507ede1933f2f"],
]);

function uniqueSwap(source, from, to) {
  assert.equal(source.split(from).length, 2, "PAGE_COMPAT_REFUSED: exactly one reviewed probe assertion may change");
  return source.replace(from, to);
}

export function verifyReviewedFivePageProbeEquivalence(read = readFileSync) {
  const probe = String(read(PROBE));
  assert.equal(renewalBlob(probe), REVIEWED_PROBE_BLOB,
    "PAGE_COMPAT_REFUSED: unreviewed page-probe change");
  const historical = uniqueSwap(probe, REVISED, ORIGINAL);
  assert.equal(renewalBlob(historical), HISTORICAL_PROBE_BLOB,
    "PAGE_COMPAT_REFUSED: historical second-pass page probe did not reconstruct");
  assert.equal(probe.split("\n").length, historical.split("\n").length,
    "PAGE_COMPAT_REFUSED: historical source-line pins must be preserved");
  for (const [path, blob] of [
    [GENERATOR, REVIEWED_GENERATOR_BLOB],
    [WORKFLOW, REVIEWED_WORKFLOW_BLOB],
    [WORKER_VERIFIER, HISTORICAL_WORKER_VERIFIER_BLOB],
  ]) assert.equal(renewalBlob(read(path)), blob,
    "PAGE_COMPAT_REFUSED: unreviewed page-credit verifier/workflow: " + path);

  const manifest = JSON.parse(String(read(MANIFEST)));
  assert.equal(manifest.scopedPages.length, 21);
  assert.equal(manifest.scopedPages.filter(p => p.status === "COVERED").length, 10);
  assert.equal(manifest.scopedPages.filter(p => p.status === "GAP").length, 11);
  const methods = Object.values(manifest.allApiRouteFiles).flatMap(file => file.methods);
  assert.equal(manifest.metrics.methods, methods.length);
  assert.equal(manifest.metrics.coveredAfter,
    methods.filter(method => method.status === "COVERED").length);
  assert.equal(manifest.metrics.gap,
    methods.filter(method => method.status === "GAP").length);
  assert.match(manifest.acceptanceStatus,
    /^NOT ACCEPTED: 5 API methods and 11 page\/action GAPs/);
  for (const [path, sourceSha, proof, proofSha] of REVIEWED_PAGES) {
    const row = manifest.scopedPages.find(p => p.path === path);
    assert.equal(row?.status, "COVERED", "PAGE_COMPAT_REFUSED: new page receipt absent");
    assert.equal(row.blob, sourceSha, "PAGE_COMPAT_REFUSED: changed page source");
    assert.equal(renewalBlob(read(path)), sourceSha);
    assert.equal(row.testedBy?.file, proof);
    assert.equal(row.testedBy?.sourcePageBlobSha, sourceSha);
    assert.equal(row.testedBy?.proofBlobSha, proofSha);
    assert.equal(renewalBlob(read(proof)), proofSha);
    assert.equal(row.testedBy?.workflowFile, WORKFLOW);
    assert.equal(row.testedBy?.actualFinalHeadRunRequired, true);
    assert.equal(row.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(row.testedBy?.methodCredits, 0);
    assert.equal(row.testedBy?.independentlyAccepted, false);
    assert.equal(row.testedBy?.productionCertified, false);
  }
  // Historical renewal remains historical. All five actual PG16 page proofs
  // and final-head CI must pass before PR merge / page-credit acceptance.
  return HISTORICAL_PROBE_BLOB;
}

/** Only the single reviewed source-only page-probe delta may satisfy the
 * historical second-pass payroll proof's former Git blob; no other cohort. */
export function isReviewedFiveScopedPageProbeInput(cohort, path, historicalBlob, read = readFileSync) {
  if (cohort !== "secondPass" || path !== PROBE || historicalBlob !== HISTORICAL_PROBE_BLOB)
    return false;
  return verifyReviewedFivePageProbeEquivalence(read) === historicalBlob;
}
