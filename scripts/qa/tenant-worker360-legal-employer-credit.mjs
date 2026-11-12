#!/usr/bin/env node
/**
 * Dedicated Worker 360 GET + SSR legal-employer credit reconciliation.
 *
 * Evidence is the successful fictional PG16 localhost HTTP push run on the
 * immutable proof-only source commit. This script never executes SQL, calls a
 * provider, modifies application source, or confers independent acceptance.
 *
 *   node scripts/qa/tenant-worker360-legal-employer-credit.mjs --write
 *   node scripts/qa/tenant-worker360-legal-employer-credit.mjs --check
 *
 * --write accepts only the exact superseded GAP pair or its own fully verified
 * existing credit; --check regenerates the expected ledger and docs in memory
 * and refuses drift. All counts derive from actual statuses, not typed totals.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const API_PATH = "src/app/api/hcm/worker-360/route.ts";
export const PAGE_PATH = "src/app/hcm/worker-360/page.tsx";
export const PROOF_PATH = "scripts/qa/tenant-hcm-worker360-entity-http.mjs";
export const WORKFLOW_PATH = ".github/workflows/tenant-hcm-worker360-entity-http.yml";
export const MANIFEST_PATH = "scripts/qa/tenant-isolation-coverage-manifest.json";
const INVENTORY = "docs/engineering/tenant-isolation-coverage-inventory.md";
const PLAN = "docs/engineering/tenant-isolation-closure-plan.md";
const PROOF_HEAD = "2f01c1a4d197da21a45a550ff1a2180859018d0f";
const RUN = 43219788230;
const JOB = 131188072874;
const URL = "https://github.com/erwinmehehe/payrollph/actions/runs/" + RUN + "/job/" + JOB;
export const INPUT_BLOBS = Object.freeze({
  [API_PATH]: "19875021d750b722fc69e0fe939e57928a158af9",
  [PAGE_PATH]: "3b506b27e0af73ec370c448c6a0ad02a80c8f75c",
  [PROOF_PATH]: "8cc7bf2cf3a9c052d4d1393c94374cfb0a93b3ae",
  [WORKFLOW_PATH]: "bf832621f18ce28c0842cb9c9c878475e9cb1b89",
  "scripts/qa/tenant-hcm-worker360-entity-contract.mjs": "ad5eeaefe57cbac6d9befa74d1f91cb6de575665",
  "tests/tenant-hcm-worker360-entity-contract.test.mjs": "30d66210607877fdec95ee41f0fa12595b143904",
  "scripts/qa/tenant-hcm-worker360-entity-build-hold.mjs": "a13c761de064540c9ee8698e6d1efd62d837cf5b",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "scripts/qa/apply-isolated-baseline.mjs": "75b9e7f1b39a6ca5b2253086e519ae7d71229255",
  "src/lib/hcm-worker-360-server.ts": "eb96de991ca31589f195e3e4e10eeccaeccf8ec6",
  "src/lib/multi-entity-server.ts": "f38a8bb77a5026d581d4a92b22533fc879ea7e00",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
});
const OLD_API = "78874e3800c9648b2e9e8895a4c0f1b2db9e2e62";
const OLD_PAGE = "337034f839c17a30077e2cfe5991c640e0c6a5e9";
const ANCHORS = Object.freeze({
  method: {
    ownPositiveLine: 137,
    foreignDenialLine: 215,
    forgedSelectorLine: 197,
    unchangedDbLine: 157,
  },
  page: {
    ownPositiveLine: 148,
    foreignDenialLine: 200,
    forgedSelectorLine: 209,
    unchangedDbLine: 157,
  },
});
const ANCHOR_MARKERS = Object.freeze({
  137: "assert.equal(api.status,200,actor.label",
  148: "assert.equal(page.status,200,actor.label",
  157: "assertReadOnly(before,await snapshot(),label)",
  197: 'await deny("A victim worker forged inside own employer GET"',
  200: 'await deny("A victim worker forged inside own employer SSR"',
  209: 'await deny("A foreign victim legal employer forged SSR query"',
  215: 'await deny("A foreign victim org"',
});
function sha(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update("blob " + buf.length + "\0").update(buf).digest("hex");
}
function sourceProof(read) {
  for (const [path, expected] of Object.entries(INPUT_BLOBS)) {
    assert.equal(sha(read(path)), expected,
      "WORKER360_CREDIT_REFUSED: changed covered source or proof " + path);
  }
  const runner = String(read(PROOF_PATH));
  const lines = runner.split("\n");
  for (const [line, fragment] of Object.entries(ANCHOR_MARKERS))
    assert.ok(lines[Number(line) - 1]?.includes(fragment),
      "WORKER360_CREDIT_REFUSED: four-part evidence line " + line);
  for (const fragment of [
    "requireIsolatedWorker360();",
    "assert.ok(victim.org.id>Math.max(a.org.id,b.org.id,6))",
    "assert.ok(victim.worker.id>Math.max(a.worker.id,b.worker.id,6))",
    'for(const actor of [a,b,victim])',
    'await own(a,a.worker,a.entity.id,ah.event',
    'await own(b,b.worker,b.entity.id,bh.event',
    'await own(victim,victim.worker,victim.entity.id,vh.event',
    'assertReadOnly(initialSnapshot,await snapshot(),"populated own HTTP responses")',
    'await deny("A foreign victim legal employer forged query"',
    'await deny("A foreign victim legal employer forged header"',
    'await deny("B victim worker forged inside own employer GET"',
    'await deny("A foreign entity SSR"',
    'await deny("revoked primary entity API"',
    'await deny("revoked primary entity SSR"',
    'assert.equal(denials,21)',
    'sourceCredits:0,productionActivated:false',
  ]) assert.ok(runner.includes(fragment), "WORKER360_CREDIT_REFUSED: missing " + fragment);
  assert.ok(runner.indexOf("requireIsolatedWorker360();") <
    runner.indexOf('import("../../src/db/index.ts")'),
    "Unsafe fixture import before isolation gate");
  const workflow = String(read(WORKFLOW_PATH));
  for (const phrase of [
    "image: postgres:16",
    "node --import tsx scripts/qa/tenant-hcm-worker360-entity-http.mjs",
    "git diff --exit-code -- src/lib/multi-entity-hcm-hold.ts",
    "TENANT_WORKER360_ENTITY_PROOF: fictional-pg16-only",
    "DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  ]) assert.ok(workflow.includes(phrase), "WORKER360_CREDIT_REFUSED: unsafe PG16 workflow: " + phrase);
  const route = String(read(API_PATH));
  const page = String(read(PAGE_PATH));
  assert.match(route, /resolveMultiEntityContext\(/);
  assert.match(page, /resolveMultiEntityContext\(/);
  assert.match(page, /eq\(employees\.legalEntityId, authorizedLegalEntityId\)/);
  assert.ok(route.includes("authorizedLegalEntityId") && page.includes("authorizedLegalEntityId"));
}
function citation(kind) {
  const selected = ANCHORS[kind];
  return {
    file: PROOF_PATH, line: selected.ownPositiveLine, ...selected,
    victimIdOrderingLine: 60,
    routeBlobSha: INPUT_BLOBS[API_PATH], pageBlobSha: INPUT_BLOBS[PAGE_PATH],
    proofBlobSha: INPUT_BLOBS[PROOF_PATH],
    workflowFile: WORKFLOW_PATH, workflowBlobSha: INPUT_BLOBS[WORKFLOW_PATH],
    contractBlobSha: INPUT_BLOBS["scripts/qa/tenant-hcm-worker360-entity-contract.mjs"],
    testBlobSha: INPUT_BLOBS["tests/tenant-hcm-worker360-entity-contract.test.mjs"],
    postgresMajor: 16, verifiedPrHeadSha: PROOF_HEAD,
    workflowRunId: RUN, workflowJobId: JOB, evidence: URL,
    evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY",
    ownerReviewer: "@erwinmehehe", ownerIsOnlyReviewer: true,
    independentlyAccepted: false, independentSecurityReview: "PENDING",
    independentHrPrivacyReview: "PENDING",
    productionTested: false, productionCertified: false,
    coverageScope: kind === "method" ? "Worker 360 GET" : "Worker 360 read-only SSR shell",
    priorSourceBlobSha: kind === "method" ? OLD_API : OLD_PAGE,
  };
}
const methodReason = "SOLO_VERIFIED_DEV_RECOVERY: exact-source fictional PostgreSQL 16 localhost real-HTTP GET proof " +
  URL + " on " + PROOF_HEAD + ": populated authorized legal-employer identity and filtered history; genuine higher-ID " +
  "foreign victim denied; other-employer employee/legal-employer selectors refused in query and legal-employer header; " +
  "protected fictional PostgreSQL snapshots unchanged on each denial. " +
  "Independent HR/privacy/security review PENDING. No production, provider, payment, payout or global isolation acceptance.";
const pageReason = "SOLO_VERIFIED_DEV_RECOVERY: Worker 360 read-only SSR shell re-proved against changed legal-employer " +
  "source over fictional PostgreSQL 16 real localhost HTTP: populated own shell, genuine cross-employer/worker " +
  "denial and forged employee/legal-employer query rejection, unchanged protected SQL. " +
  "No client hydration, interactive UI, production rollout or independent HR/privacy/security acceptance.";
export function verifyWorker360LegalEmployerCredits(manifest, read = readFileSync) {
  sourceProof(read);
  const api = manifest.allApiRouteFiles?.[API_PATH];
  const page = manifest.scopedPages?.find(entry => entry.path === PAGE_PATH);
  const method = api?.methods?.find(entry => entry.name === "GET");
  assert.equal(api?.gitBlobSha, INPUT_BLOBS[API_PATH]);
  assert.equal(page?.blob, INPUT_BLOBS[PAGE_PATH]);
  assert.equal(api.methods.length, 1, "One GET, never a blanket API credit");
  assert.equal(method?.status, "COVERED");
  assert.equal(page?.status, "COVERED");
  assert.equal(method.reviewedUncertified, undefined);
  assert.equal(page.reviewedUncertified, undefined);
  assert.equal(method.reason, methodReason);
  assert.equal(page.reason, pageReason);
  assert.deepEqual(method.testedBy, citation("method"),
    "GET proof must be source/run/line pinned");
  assert.deepEqual(page.testedBy, citation("page"),
    "SSR proof must be source/run/line pinned");
  assert.equal(manifest.scopedPages.filter(row => row.status === "GAP").length, 16);
  const methods = Object.values(manifest.allApiRouteFiles).flatMap(file => file.methods);
  assert.equal(methods.filter(m => m.status === "COVERED").length, 457);
  assert.equal(methods.filter(m => m.status === "GAP").length, 6);
  assert.equal(manifest.metrics.coveredAfter, 457);
  assert.equal(manifest.metrics.gap, 6);
  assert.equal(manifest.metrics.methods, 498);
  assert.equal(manifest.metrics.scopedPagesAndActions, 21);
  assert.ok(String(manifest.acceptanceStatus).startsWith("NOT ACCEPTED: 6 API methods and 16 page/action GAPs"));
  return 2;
}
function regenerate(original, read = readFileSync) {
  sourceProof(read);
  const m = structuredClone(original);
  const api = m.allApiRouteFiles[API_PATH], method = api.methods.find(x => x.name === "GET");
  const page = m.scopedPages.find(x => x.path === PAGE_PATH);
  assert.equal(api.gitBlobSha, INPUT_BLOBS[API_PATH]);
  assert.equal(page.blob, INPUT_BLOBS[PAGE_PATH]);
  if (method.status === "GAP") {
    assert.equal(method.testedBy, null);
    assert.equal(method.reviewedUncertified?.kind,
      "worker360-legal-employer-source-supersession-zero-credit");
    assert.equal(method.reviewedUncertified?.coverageCredits, 0);
    assert.equal(page.status, "GAP");
    assert.equal(page.testedBy, undefined);
    assert.equal(page.reviewedUncertified?.coverageCredits, 0);
    assert.equal(m.scopedPages.filter(x => x.status === "GAP").length, 17);
  } else {
    verifyWorker360LegalEmployerCredits(m, read);
  }
  method.status = "COVERED";
  method.reason = methodReason;
  method.testedBy = citation("method");
  delete method.reviewedUncertified;
  page.status = "COVERED";
  page.reason = pageReason;
  page.testedBy = citation("page");
  delete page.reviewedUncertified;
  const methods = Object.values(m.allApiRouteFiles).flatMap(file => file.methods);
  for (const [key, status] of [
    ["coveredAfter", "COVERED"], ["gap", "GAP"],
    ["publicByDesign", "PUBLIC-BY-DESIGN"],
    ["privilegedOperationsTokenOnly", "PRIVILEGED-OPERATIONS-TOKEN-ONLY"],
  ]) m.metrics[key] = methods.filter(x => x.status === status).length;
  m.metrics.methods = methods.length;
  m.metrics.routeFiles = Object.keys(m.allApiRouteFiles).length;
  m.metrics.scopedPagesAndActions = m.scopedPages.length;
  const pageGaps = m.scopedPages.filter(x => x.status === "GAP").length;
  m.acceptanceStatus = m.acceptanceStatus.replace(
    /^NOT ACCEPTED: \d+ API methods and \d+ page\/action GAPs/,
    "NOT ACCEPTED: " + m.metrics.gap + " API methods and " + pageGaps + " page/action GAPs");
  const note = " Worker 360 exact-source reproof: one GET and one SSR shell provisional " +
    "SOLO_VERIFIED_DEV_RECOVERY credit linked to " + URL + "; independent HR/privacy/security review " +
    "PENDING, production and overall tenant isolation NOT ACCEPTED.";
  if (!m.acceptanceStatus.includes(note)) m.acceptanceStatus += note;
  verifyWorker360LegalEmployerCredits(m, read);
  return m;
}
const notice = "> **CURRENT Worker 360 source recovery — SOLO_VERIFIED_DEV_RECOVERY / NOT ACCEPTED:** " +
  "498 methods = **457 COVERED / 23 PUBLIC-BY-DESIGN / 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY / 6 GAP**; " +
  "**5 of 21 scoped pages COVERED / 16 GAP**. Worker 360 GET and SSR shell each have exact-source " +
  "fictional PG16 real-HTTP evidence [run 43219788230](" + URL + "). " +
  "Independent HR/privacy/security review and production activation remain PENDING.\n\n";
function renderDocs(path, existing) {
  let s = existing.startsWith(notice) ? existing : notice + existing;
  if (path === INVENTORY) {
    s = s.replace("| coveredAfter | 456 |", "| coveredAfter | 457 |")
      .replace("| gap | 7 |", "| gap | 6 |")
      .replace("**RELEASE BLOCKER:** 7 API methods and 17 business-ID page entries",
        "**RELEASE BLOCKER:** 6 API methods and 16 business-ID page entries")
      .replace("**NOT ACCEPTED**: 7 method gaps and 17 page/action gaps remain.",
        "**NOT ACCEPTED**: 6 method gaps and 16 page/action gaps remain.");
    const lines = s.split("\n");
    let methodRows = 0, pageRows = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("| [`hcm/worker-360` GET](")) {
        lines[i] = lines[i].replace(
          /\| \[Tenant-table own-marker\/victim PG16 proof\][^|]+\| \*\*COVERED\*\* \|$/,
          "| [Renewed GET legal-employer PG16 proof](../../" + PROOF_PATH +
          "#L137), victim denial L215, forged selector L197, unchanged SQL L157; " +
          "[passed run](" + URL + ") | **COVERED** (SOLO_VERIFIED_DEV_RECOVERY) |");
        assert.ok(lines[i].includes("Renewed GET legal-employer"), "Missing GET row rewrite");
        methodRows++;
      }
      if (lines[i].startsWith("| [`src/app/hcm/worker-360/page.tsx`](")) {
        lines[i] = lines[i].replace(
          /\| \[Own-worker 200 \/ actual foreign-worker 404 on independent PG16 SSR\][^|]+\| \*\*COVERED\*\* \(provisional SSR shell only\) \|$/,
          "| [Renewed legal-employer SSR proof](../../" + PROOF_PATH +
          "#L148), victim worker rejection L200, forged legal employer L209, " +
          "unchanged SQL L157; [passed run](" + URL + ") | **COVERED** (SOLO_VERIFIED_DEV_RECOVERY, SSR only) |");
        assert.ok(lines[i].includes("Renewed legal-employer SSR"), "Missing SSR row rewrite");
        pageRows++;
      }
    }
    assert.equal(methodRows, 1);
    assert.equal(pageRows, 1);
    s = lines.join("\n");
  }
  if (path === PLAN) {
    s = s.replace("Frozen subtotal (2026-11-11 classification proposal): **372 COVERED + 15 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 7 GAP = 406**",
      "Frozen subtotal (2026-11-11 classification proposal, renewed Worker 360 proof): **373 COVERED + 15 PUBLIC-BY-DESIGN + 12 PRIVILEGED-OPERATIONS-TOKEN-ONLY + 6 GAP = 406**");
  }
  return s;
}
function main() {
  const argv = process.argv.slice(2);
  assert.ok(argv.length === 1 && ["--write", "--check"].includes(argv[0]),
    "WORKER360_CREDIT_REFUSED: expected --write or --check");
  const beforeRaw = readFileSync(MANIFEST_PATH, "utf8");
  const updated = regenerate(JSON.parse(beforeRaw));
  const expectedManifest = JSON.stringify(updated, null, 2) + "\n";
  const expectedInventory = renderDocs(INVENTORY, readFileSync(INVENTORY, "utf8"));
  const expectedPlan = renderDocs(PLAN, readFileSync(PLAN, "utf8"));
  if (argv[0] === "--write") {
    writeFileSync(MANIFEST_PATH, expectedManifest);
    writeFileSync(INVENTORY, expectedInventory);
    writeFileSync(PLAN, expectedPlan);
  } else {
    assert.equal(beforeRaw, expectedManifest, "Manifest must equal regenerated coverage ledger");
    assert.equal(readFileSync(INVENTORY, "utf8"), expectedInventory,
      "Coverage inventory must equal regenerated proof links and metrics");
    assert.equal(readFileSync(PLAN, "utf8"), expectedPlan,
      "Closure plan must equal regenerated Worker 360 count");
  }
  console.log(JSON.stringify({
    label: "SOLO_VERIFIED_DEV_RECOVERY", mode: argv[0], proofRun: RUN,
    proofHead: PROOF_HEAD, apiCovered: updated.metrics.coveredAfter,
    apiGaps: updated.metrics.gap,
    scopedPagesCovered: updated.scopedPages.filter(x => x.status === "COVERED").length,
    scopedPagesGap: updated.scopedPages.filter(x => x.status === "GAP").length,
    credited: ["GET /api/hcm/worker-360", "GET /hcm/worker-360"],
    independentReview: "PENDING", productionAcceptance: false,
  }));
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-worker360-legal-employer-credit.mjs"))
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
