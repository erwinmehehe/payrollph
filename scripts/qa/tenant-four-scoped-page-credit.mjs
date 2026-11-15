/**
 * Four scoped page-only provisional credits. No API methods or runtime source.
 * Only exact PR-head fictional PG16/HTTP proof jobs can justify retaining a
 * SOLO_VERIFIED_DEV_RECOVERY status. All historical evidence stays immutable.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  verifyFivePageCredits,
  verifyCurrentScopedPageGapCount as verifyHistoricPageGapCount,
} from "./tenant-five-scoped-page-credit.mjs";

export const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
export const SELECTION = "scripts/qa/tenant-four-page-selection.json";
export const WORKFLOW = ".github/workflows/tenant-four-scoped-pages-credit.yml";
const define = (key, path, sha, proof, proofSha, contract, contractSha, anchors, notTested) =>
  ({key, path, sha, proof, proofSha, contract, contractSha, anchors, notTested});
export const TARGETS = Object.freeze([
  define("action", "src/app/hcm/action-center/page.tsx",
    "5d593fd3c4c28d99792c3ac2450e2616c5cd6f9e",
    "scripts/qa/tenant-hcm-action-center-http.mjs",
    "2feb01b3b95bc53a2be1277f73f4f707e01ced22",
    "scripts/qa/tenant-hcm-action-center-contract.mjs",
    "18e408ebe189cdd539a3cd66e3b79d5a30f3cc97",
    ["assertOwnPage(await get(url(actor.org.id), actor.cookie, headers)",
     "await deny(url(target.org.id), actor.cookie, {}, true)",
     "assertSqlUnchanged(baselines.get(actor.org.id), await snapshot(actor.org.id)",
     "await deny(url(ids[0]) + \"&organizationId=\" + ids[1], actor.cookie)",
     "active: false }]) {",
     "assert.ok(victim[k].id > Math.max(a[k].id, b[k].id, 6)"],
    "Hydrated action/panel clicks, mutations, same-parent legal-entity enabled operation, production and independent HR/privacy review"),
  define("org", "src/app/hcm/org-explorer/page.tsx",
    "89df291ced721e908d1c3023b8ec8c94919f479c",
    "scripts/qa/tenant-hcm-org-explorer-page-http.mjs",
    "ba5000e43042fbaea822530769ab04def95f448a",
    "scripts/qa/tenant-hcm-org-explorer-page-contract.mjs",
    "f6bcf1441d3ff85a3e0f247ad50cf131e034fc04",
    ["assertOwnPage(await httpGet(pageUrl(actor.org.id), cookie), actor, all)",
     "await deny(pageUrl(other.org.id), actor.cookie, 404",
     "assertSqlUnchanged(",
     "await deny(pageUrl(actor.org.id + \"&organizationId=\" + victim.org.id)",
     "await deny(pageUrl(a.org.id), a.cookie, 404, \"revoked owner SSR\")",
     "assert.ok(victim[name].id > Math.max(a[name].id, b[name].id, 6)"],
    "Mutating org/position actions, disabled multi-entity mode, all browser/device varieties, production and independent HR/privacy review"),
  define("billing", "src/app/billing/setup/page.tsx",
    "c5830a95d2c13063c43a36629690010220d99d31",
    "scripts/qa/tenant-billing-setup-page-http.mjs",
    "c29179b97f7a24f63b2ec44d19e0da68544d4765",
    "tests/tenant-billing-setup-boundary.test.mjs",
    "2595809bec34048c86a9b5e4fe4e8abc1c213987",
    ["assertOwnBillingPage(await readLocal(ownPath(actor.org.id), actor.cookie)",
     "assertDeniedBillingPage(denied, subjects, actor.label + \" -> \" + other.label)",
     "assert.deepEqual(await snapshot(other.org.id), before.get(other.org.id)",
     "assertDeniedBillingPage(await readLocal(ownPath(actor.org.id) +",
     "assertDeniedBillingPage(await readLocal(ownPath(a.org.id), a.cookie)",
     "assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id"],
    "Checkout, billing provider network, payments/subscription mutation, hydrated browser, production and independent finance/security review"),
  define("ess", "src/app/self/schedule-receipts/page.tsx",
    "cf5947bea1bc5aa8a8b87f54d53bc4ffceb2575e",
    "scripts/qa/tenant-self-schedule-page-http.mjs",
    "9b1fd190a2b2833b5ca6c4cf0bcab8a13feea050",
    "tests/tenant-self-schedule-page-contract.test.mjs",
    "5e606008a4f50550cb0357f3f2d1e1a6698a8551",
    ["assertOwnPage(own, actor, subjects.filter(e => e !== actor))",
     "assertDeniedPage(await request(PATH, forgedSession.cookie)",
     "assertUnchanged(before.get(subject.org.id), await snapshot(subject.org.id)",
     "assertDeniedPage(await request(PATH + forged, actor.self.cookie)",
     "assertDeniedPage(await request(PATH, a.self.cookie), subjects, \"revoked Alpha member\")",
     "assert.ok(victim.worker.id > b.worker.id && b.worker.id > a.worker.id"],
    "Hydrated client/actions, concurrent receipt writes, feature-OFF behavior, production and independent worker privacy review"),
]);
export const EXTRA_ESS_PROOF = "scripts/qa/tenant-four-ess-receipts-http.mjs";
export const EXTRA_ESS_PROOF_SHA = "99ec0e1ffac4da92f2b266ac4963ce65621b26a2";
export const EXTRA_ESS_CONTRACT = "scripts/qa/tenant-self-schedule-receipts-contract.mjs";
export const EXTRA_ESS_CONTRACT_SHA = "33a6977f1b8a7de85c67081d8d5a63f393cdbcf5";
const NOTE_PREFIX = " Four page-only SOLO_VERIFIED_DEV_RECOVERY proofs:";

export function gitBlobSha(content) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update("blob " + data.length + "\0").update(data).digest("hex");
}
export function selectedTargets(read = readFileSync) {
  const selection = JSON.parse(String(read(SELECTION)));
  assert.equal(selection.schema, "tenant-four-page-proof-selection-v1");
  assert.equal(selection.status, "CANDIDATE_EXACT_HEAD_CI_REQUIRED");
  assert.equal(selection.independentlyAccepted, false);
  assert.equal(selection.productionCertified, false);
  assert.ok(Array.isArray(selection.selected) && selection.selected.length > 0,
    "FOUR_PAGE_REFUSED: empty/hold-only page selection forbidden");
  assert.equal(new Set(selection.selected).size, selection.selected.length,
    "FOUR_PAGE_REFUSED: duplicate page keys");
  for (const key of selection.selected)
    assert.ok(TARGETS.some(t => t.key === key), "FOUR_PAGE_REFUSED: unrelated page " + key);
  return TARGETS.filter(target => selection.selected.includes(target.key));
}
function proofAnchor(source, marker, label) {
  const matches = source.split("\n").flatMap(
    (line, index) => line.includes(marker) ? [index + 1] : []);
  assert.equal(matches.length, 1,
    "FOUR_PAGE_REFUSED: missing/ambiguous exact proof anchor " + label + " " + marker);
  return matches[0];
}
export function verifyFourInputs(read = readFileSync) {
  const workflow = String(read(WORKFLOW));
  for (const required of [
    "github.event.pull_request.head.sha", "git rev-parse HEAD",
    "image: postgres:16", "npm run db:push", "apply-isolated-baseline.mjs",
    "npm run build", "--hostname 127.0.0.1", "fail-fast: false",
    "needs: [page-http-reproof]", "tenant-four-scoped-page-credit.mjs --check",
    'NEXT_CSP_ENABLED: "false"', 'PAYROLL_CALCULATION_HISTORY_ENABLED: "false"',
    'WORKER_ENABLED: "false"', 'CENTRAL_SCHEDULER_ENABLED: "false"',
    'PAYMONGO_DISBURSEMENTS_ENABLED: "false"', 'XENDIT_PAYOUTS_ENABLED: "false"',
    'XENDIT_BILLING_ENABLED: "false"',
  ]) assert.ok(workflow.includes(required), "FOUR_PAGE_REFUSED: missing workflow guard " + required);
  assert.ok(!workflow.includes("secrets."),
    "FOUR_PAGE_REFUSED: workflow may not consume external/prod secrets");
  const selected = selectedTargets(read);
  const anchors = new Map();
  assert.equal(TARGETS.length, 4);
  assert.equal(new Set(TARGETS.map(t => t.path)).size, TARGETS.length);
  for (const t of TARGETS) {
    assert.equal(gitBlobSha(read(t.path)), t.sha,
      "FOUR_PAGE_REFUSED: source-page SHA changed " + t.path);
    if (!selected.includes(t)) continue;
    assert.equal(gitBlobSha(read(t.proof)), t.proofSha,
      "FOUR_PAGE_REFUSED: original proof changed " + t.proof);
    assert.equal(gitBlobSha(read(t.contract)), t.contractSha,
      "FOUR_PAGE_REFUSED: original contract/guard changed " + t.contract);
    assert.ok(workflow.includes(t.proof) && workflow.includes(t.contract),
      "FOUR_PAGE_REFUSED: page/contract missing from current-head CI " + t.key);
    const source = String(read(t.proof));
    anchors.set(t.key, t.anchors.map((marker, i) =>
      proofAnchor(source, marker, t.key + "/" + i)));
  }
  if (selected.some(t => t.key === "ess")) {
    assert.equal(gitBlobSha(read(EXTRA_ESS_PROOF)), EXTRA_ESS_PROOF_SHA,
      "FOUR_PAGE_REFUSED: peer/receipt HTTP proof changed");
    assert.equal(gitBlobSha(read(EXTRA_ESS_CONTRACT)), EXTRA_ESS_CONTRACT_SHA,
      "FOUR_PAGE_REFUSED: receipt API safety guard changed");
    const extra = String(read(EXTRA_ESS_PROOF));
    for (const marker of [
      "await post(actor.peer", "assert.equal(peerRows.length, 1",
      "Existing colleague versus absent worker must share denial status",
      "Real foreign-employer worker and unknown worker must be indistinguishable",
      "await denied(actor.label + \" forged victim employee link GET\"",
      "assertUnchanged(victimBefore, await snapshot(victim.org.id)",
    ]) assert.ok(extra.includes(marker), "FOUR_PAGE_REFUSED: ESS missing " + marker);
    assert.ok(workflow.includes(EXTRA_ESS_PROOF) && workflow.includes(EXTRA_ESS_CONTRACT));
  }
  return {selected, anchors};
}
function reason(t) {
  return "SOLO_VERIFIED_DEV_RECOVERY: candidate exact-source fictional PG16, real authenticated " +
    "Next SSR HTTP page: legitimate populated 200; actual higher-ID foreign victim denied; " +
    "forged/revoked/inactive selectors or sessions denied; protected victim business/audit SQL " +
    "byte-equivalent before and after. ESS also requires a feature-ON two-attacker real receipt " +
    "API run with same-employer worker isolation and existing-vs-nonexistent denial parity. " +
    "Only successful exact-PR-head jobs justify retention. No method credits, production, money, " +
    "or independent acceptance. Exclusions: " + t.notTested + ".";
}
function citation(t, previousReason, lines) {
  assert.ok(typeof previousReason === "string" && previousReason.length > 15,
    "FOUR_PAGE_REFUSED: preserve original page GAP explanation");
  return {
    file: t.proof, line: lines[0], ownPositiveLine: lines[0],
    foreignDenialLine: lines[1], unchangedDbLine: lines[2],
    forgedSelectorLine: lines[3], revokedDenialLine: lines[4],
    victimIdOrderingLine: lines[5],
    sourcePageBlobSha: t.sha, proofBlobSha: t.proofSha,
    contractFile: t.contract, contractBlobSha: t.contractSha,
    ...(t.key === "ess" ? {
      companionReceiptProof: EXTRA_ESS_PROOF, companionReceiptProofSha: EXTRA_ESS_PROOF_SHA,
      companionReceiptContract: EXTRA_ESS_CONTRACT,
      companionReceiptContractSha: EXTRA_ESS_CONTRACT_SHA,
    } : {}),
    workflowFile: WORKFLOW, proofFamily: t.key,
    previousGapReason: previousReason,
    evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY",
    postgresMajor: 16, actualFinalHeadRunRequired: true,
    pageProofStatus: "FINAL_HEAD_CI_REQUIRED",
    methodCredits: 0, independentlyAccepted: false,
    independentSecurityReview: "PENDING", independentHrPrivacyReview: "PENDING",
    productionTested: false, productionCertified: false,
    notTested: t.notTested,
  };
}
export function expectedFourPageManifest(input, read = readFileSync) {
  const {selected, anchors} = verifyFourInputs(read);
  const m = structuredClone(input);
  assert.equal(m.scopedPages.length, 21, "FOUR_PAGE_REFUSED: original page count changed");
  for (const t of TARGETS) {
    const row = m.scopedPages.find(p => p.path === t.path);
    assert.ok(row && row.blob === t.sha && row.hasAction === false,
      "FOUR_PAGE_REFUSED: source/action mismatch " + t.path);
    if (!selected.includes(t)) {
      assert.equal(row.status, "GAP", "FOUR_PAGE_REFUSED: unselected page must stay GAP");
      assert.equal(row.testedBy, undefined, "FOUR_PAGE_REFUSED: unselected receipt prohibited");
      continue;
    }
    const previous = row.status === "GAP" ? row.reason : row.testedBy?.previousGapReason;
    const receipt = citation(t, previous, anchors.get(t.key));
    if (row.status === "GAP") {
      assert.equal(row.testedBy, undefined, "FOUR_PAGE_REFUSED: stale receipt");
      row.status = "COVERED";
      row.reason = reason(t);
      row.testedBy = receipt;
    } else {
      assert.equal(row.status, "COVERED", "FOUR_PAGE_REFUSED: unknown page classification");
      assert.equal(row.reason, reason(t), "FOUR_PAGE_REFUSED: altered page reasoning");
      assert.deepEqual(row.testedBy, receipt, "FOUR_PAGE_REFUSED: altered proof receipt");
    }
  }
  const methods = Object.values(m.allApiRouteFiles).flatMap(file => file.methods);
  m.metrics.routeFiles = Object.keys(m.allApiRouteFiles).length;
  m.metrics.methods = methods.length;
  for (const [key, status] of [
    ["coveredAfter", "COVERED"], ["gap", "GAP"],
    ["publicByDesign", "PUBLIC-BY-DESIGN"],
    ["privilegedOperationsTokenOnly", "PRIVILEGED-OPERATIONS-TOKEN-ONLY"],
  ]) m.metrics[key] = methods.filter(entry => entry.status === status).length;
  m.metrics.scopedPagesAndActions = m.scopedPages.length;
  const selectedAlreadyCovered = selected.filter(t =>
    input.scopedPages.find(p => p.path === t.path)?.status === "COVERED").length;
  const coveredBefore = input.scopedPages.filter(p => p.status === "COVERED").length
    - selectedAlreadyCovered;
  const gapsBefore = input.scopedPages.filter(p => p.status === "GAP").length
    + selectedAlreadyCovered;
  const covered = m.scopedPages.filter(p => p.status === "COVERED").length;
  const gaps = m.scopedPages.filter(p => p.status === "GAP").length;
  assert.equal(covered, coveredBefore + selected.length,
    "FOUR_PAGE_REFUSED: unrelated page credit changed");
  assert.equal(gaps, gapsBefore - selected.length,
    "FOUR_PAGE_REFUSED: unrelated page GAP altered");
  assert.equal(covered + gaps, m.scopedPages.length);
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED: \d+ API methods and \d+ page\/action GAPs/);
  m.acceptanceStatus = m.acceptanceStatus.split(NOTE_PREFIX)[0].replace(
    /^NOT ACCEPTED: \d+ API methods and \d+ page\/action GAPs/,
    "NOT ACCEPTED: " + m.metrics.gap + " API methods and " + gaps + " page/action GAPs");
  m.acceptanceStatus += NOTE_PREFIX + " " + covered + "/" + m.scopedPages.length +
    " provisional COVERED, " + gaps + " GAP; exact-final-head PG16 proof jobs mandatory; " +
    "no added API methods, production or independent authorization.";
  return m;
}
export function historicFourPageView(input, read = readFileSync) {
  const {selected, anchors} = verifyFourInputs(read);
  const historical = structuredClone(input);
  for (const t of selected) {
    const row = historical.scopedPages.find(p => p.path === t.path);
    assert.equal(row?.status, "COVERED", "FOUR_PAGE_REFUSED: missing selected receipt");
    assert.equal(row.reason, reason(t), "FOUR_PAGE_REFUSED: changed coverage reasoning");
    assert.deepEqual(row.testedBy, citation(t, row.testedBy?.previousGapReason,
      anchors.get(t.key)), "FOUR_PAGE_REFUSED: forged historical page receipt");
    row.reason = row.testedBy.previousGapReason;
    row.status = "GAP";
    delete row.testedBy;
  }
  const gaps = historical.scopedPages.filter(p => p.status === "GAP").length;
  assert.equal(historical.scopedPages.length, 21);
  historical.acceptanceStatus = historical.acceptanceStatus.split(NOTE_PREFIX)[0].replace(
    /^NOT ACCEPTED: \d+ API methods and \d+ page\/action GAPs/,
    "NOT ACCEPTED: " + historical.metrics.gap + " API methods and " + gaps + " page/action GAPs");
  return historical;
}
export function verifyFourPageCredits(manifest, read = readFileSync) {
  assert.deepEqual(manifest, expectedFourPageManifest(manifest, read),
    "FOUR_PAGE_REFUSED: manifest must be generated, source-exact and tamper free");
  assert.equal(verifyFivePageCredits(historicFourPageView(manifest, read), read), 5,
    "FOUR_PAGE_REFUSED: five earlier page receipts must remain unchanged");
  return selectedTargets(read).length;
}
export function verifyCurrentScopedPageGapCount(manifest, read = readFileSync) {
  const gaps = manifest.scopedPages.filter(p => p.status === "GAP").length;
  if (gaps === 11 || gaps === 16)
    return verifyHistoricPageGapCount(manifest, read);
  assert.equal(verifyFourPageCredits(manifest, read), selectedTargets(read).length,
    "FOUR_PAGE_REFUSED: live inventory requires current four-page proof receipts");
  return gaps;
}
function main() {
  assert.ok(process.argv.length === 3 && ["--write", "--check"].includes(process.argv[2]),
    "FOUR_PAGE_REFUSED: --write or --check required");
  const raw = readFileSync(MANIFEST, "utf8");
  const expected = expectedFourPageManifest(JSON.parse(raw));
  const output = JSON.stringify(expected, null, 2) + "\n";
  if (process.argv[2] === "--write") writeFileSync(MANIFEST, output);
  else assert.equal(raw, output, "FOUR_PAGE_REFUSED: manifest was not generated by the tool");
  assert.equal(verifyFourPageCredits(expected), selectedTargets().length);
  console.log(JSON.stringify({
    evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY",
    beforeCovered: expected.scopedPages.filter(p => p.status === "COVERED").length -
      selectedTargets().length,
    beforeGaps: expected.scopedPages.filter(p => p.status === "GAP").length +
      selectedTargets().length,
    afterCovered: expected.scopedPages.filter(p => p.status === "COVERED").length,
    afterGaps: expected.scopedPages.filter(p => p.status === "GAP").length,
    newApiMethodCredits: 0,
    selected: selectedTargets().map(t => t.key), exactFinalHeadCiRequired: true,
    independentlyAccepted: false, productionCertified: false,
  }));
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-four-scoped-page-credit.mjs"))
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }