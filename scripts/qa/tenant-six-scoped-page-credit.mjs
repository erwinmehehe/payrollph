/**
 * Provisional six-page proof + credit generator, independent of API methods.
 * The exact-final-head fictional PG16 matrix MUST pass before a credit can
 * be retained. Earlier five-page and Worker360 credits remain immutable.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { verifyFivePageCredits } from "./tenant-five-scoped-page-credit.mjs";

export const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
export const SELECTION = "scripts/qa/tenant-six-page-selection.json";
export const WORKFLOW = ".github/workflows/tenant-six-scoped-pages-credit.yml";
const define = (key, path, pageSha, proof, proofSha, contract, contractSha, anchors, notTested) =>
  ({key, path, pageSha, proof, proofSha, contract, contractSha, anchors, notTested});
export const TARGETS = Object.freeze([
  define("hr", "src/app/hcm/hr-cases/page.tsx",
    "0d384a61699a9183bfd4fa55665a0d1154031442",
    "scripts/qa/tenant-hr-cases-page-http.mjs",
    "b5c930b19db80f78d889273e41fb442205c6ad9f",
    "scripts/qa/tenant-hr-cases-page-contract.mjs",
    "044be9f247cf8f4a55e6a68f47d5cf1ad669a7f5",
    ["assertOwnHrPage(await httpGet(pagePath(actor.org.id)", "await deny(pagePath(foreign.org.id)",
     "await verifyUnchanged(actor.label +", "duplicate page employer",
     "revoked owner page", 'newEmployer("VICTIM")'],
    "Hydrated HR case actions, COE delivery, multi-entity-on HR queue, production and independent privacy review"),
  define("report", "src/app/workspace/report-builder/page.tsx",
    "24512c4c9f727ca02589e53da81cf38ffed264c9",
    "scripts/qa/tenant-report-builder-page-http.mjs",
    "c4861818882fd4782a2eac383824e84336890a71",
    "scripts/qa/tenant-report-builder-page-contract.mjs",
    "7c8005b7d2b446d951d2727fd66b6575ea6c48ed",
    ["assertOwnReportPage(await readLocal(pagePath(actor.org.id)",
     "assertForeignReportPage(await readLocal(pagePath(other.org.id)",
     "assertReadOnlyReportSnapshot(before.get(employer.org.id)",
     "const duplicate = await readLocal(pagePath(actor.org.id)",
     "assertForeignReportPage(await readLocal(pagePath(a.org.id), a.cookie)",
     'seedEmployer("VICTIM"'],
    "Complete report builder POST/CSV user journeys, all client actions, multi-entity attribution and independent privacy review"),
  define("2316", "src/app/workspace/2316/page.tsx",
    "f4badb3f1782812aab672665340e967911cff2cb",
    "scripts/qa/tenant-2316-ssr-transfer-http.mjs",
    "7f4fb04ae57a72ccd981ca4f36771adf2c62cc06",
    "scripts/qa/tenant-2316-ssr-transfer-contract.mjs",
    "CONTRACT_SHA_AFTER_CREDIT_AWARE_GUARD",
    ["assertOwn2316(ownReleasedPage", "await deny(certPath(actor.org.id, foreign.worker.id)",
     "assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)",
     "noncanonical/replayed Form 2316 selector", "revoked frozen legal-employer grant",
     'seedEmployer("VICTIM"'],
    "PDF issuance, government filing, live payroll/tax, production, independent payroll-security review"),
  define("prior", "src/app/workspace/prior-employer/page.tsx",
    "e55809f26075c142240675826a0c353d403a20e6",
    "scripts/qa/tenant-prior-review-worker-http.mjs",
    "db38b5ce9e33c42feb81a69929849c2c52a6d004",
    "scripts/qa/tenant-prior-review-worker-contract.mjs",
    "428b115e1814942fdfbb43f799010745af55f3de",
    ["assertPriorOwnPage(own, actor", "foreign worker under own employer",
     "assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)",
     "duplicate employer selector", "revoked active membership with valid session",
     'seedEmployer("VICTIM"'],
    "Prior-evidence edits/submissions, client actions, live filing, production, independent payroll-tax review"),
  define("hire", "src/app/hcm/hire-payroll-review/page.tsx",
    "ceb2fec2b4a16d77d04ce25fccffbe6a6770249f",
    "scripts/qa/tenant-hire-payroll-review-http.mjs",
    "38b87f3f71fd15e93ac096bcc9c16899fb76b0b2",
    "scripts/qa/tenant-hire-payroll-review-contract.mjs",
    "188a60edbf47b81e8c471d6cde75a8a11b7c8d28",
    ["assertOwnedHirePage(response", "await deny(pathFor(actor.org.id, outsider.worker.id)",
     "assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)",
     "duplicated worker selector", "revoked membership with still-valid session",
     'seedEmployer("VICTIM"'],
    "Hire/payroll mutations, broader legal-employer switching, calculation/release, production, independent HR review"),
  define("monitor", "src/app/hcm/process-monitor/page.tsx",
    "977ae3415144cfa509e709c9a9422d93b6a9f97a",
    "scripts/qa/tenant-hcm-process-monitor-http.mjs",
    "a49f666887b87a9b95de6e73b7d1190ab5e03fe1",
    "scripts/qa/tenant-hcm-process-monitor-contract.mjs",
    "bb65472687e93dd80706e7aa8f52187e545f0b29",
    ["assertOwnMonitorPage(own, actor", "real foreign process under own employer",
     "assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id)",
     "forged or duplicated selector", "revoked member still signed in",
     'seedEmployer("VICTIM"'],
    "Process mutation/approval, hydrated actions, legal-employer multi-entity, production and independent privacy review"),
]);
export function gitBlobSha(content) {
  const b = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
}
export function selectedTargets(read = readFileSync) {
  const s = JSON.parse(String(read(SELECTION)));
  assert.equal(s.schema, "tenant-six-page-proof-selection-v1");
  assert.equal(s.independentlyAccepted, false);
  assert.equal(s.productionCertified, false);
  assert.equal(s.status, "CANDIDATE_EXACT_HEAD_CI_REQUIRED");
  assert.ok(Array.isArray(s.selected) && s.selected.length > 0,
    "SIX_PAGE_REFUSED: no hold-only or empty PR");
  assert.equal(new Set(s.selected).size, s.selected.length);
  for (const key of s.selected) assert.ok(TARGETS.some(t => t.key === key),
    "SIX_PAGE_REFUSED: page outside approved six");
  return TARGETS.filter(t => s.selected.includes(t.key));
}
function line(source, marker, label) {
  const lines = source.split("\n");
  const matches = lines.flatMap((value, index) => value.includes(marker) ? [index + 1] : []);
  assert.equal(matches.length, 1,
    "SIX_PAGE_REFUSED: ambiguous/missing proof anchor " + label + ": " + marker);
  return matches[0];
}
export function verifySixInputs(read = readFileSync) {
  const workflow = String(read(WORKFLOW));
  for (const item of [
    "github.event.pull_request.head.sha", "git rev-parse HEAD", "image: postgres:16",
    "npm run db:push", "apply-isolated-baseline.mjs", "npm run build",
    "--hostname 127.0.0.1", "fail-fast: false", "needs: [page-http-reproof]",
    'NEXT_CSP_ENABLED: "false"', 'PAYROLL_CALCULATION_HISTORY_ENABLED: "false"',
    'WORKER_ENABLED: "false"', 'PAYMONGO_DISBURSEMENTS_ENABLED: "false"',
    'XENDIT_PAYOUTS_ENABLED: "false"', 'XENDIT_BILLING_ENABLED: "false"',
  ]) assert.ok(workflow.includes(item),
    "SIX_PAGE_REFUSED: missing source-exact proof workflow guard " + item);
  assert.ok(!workflow.includes("secrets."),
    "SIX_PAGE_REFUSED: credential-backed workflow is forbidden");
  const selected = selectedTargets(read);
  const anchors = new Map();
  assert.equal(new Set(TARGETS.map(t => t.path)).size, 6);
  for (const t of TARGETS) {
    assert.equal(gitBlobSha(read(t.path)), t.pageSha,
      "SIX_PAGE_REFUSED: changed page source " + t.path);
    if (!selected.includes(t)) continue;
    assert.equal(gitBlobSha(read(t.proof)), t.proofSha,
      "SIX_PAGE_REFUSED: changed proof " + t.proof);
    assert.equal(gitBlobSha(read(t.contract)), t.contractSha,
      "SIX_PAGE_REFUSED: changed contract " + t.contract);
    assert.ok(workflow.includes(t.proof) && workflow.includes(t.contract),
      "SIX_PAGE_REFUSED: real matrix execution missing " + t.key);
    anchors.set(t.key, t.anchors.map((marker, index) =>
      line(String(read(t.proof)), marker, t.key + "/" + index)));
  }
  return {selected, anchors};
}
function makeCitation(t, previousReason, lines) {
  assert.ok(typeof previousReason === "string" &&
    previousReason.startsWith("Still GAP:"),
    "SIX_PAGE_REFUSED: prior GAP reason is required");
  return {
    file: t.proof, line: lines[0], ownPositiveLine: lines[0],
    foreignDenialLine: lines[1], unchangedDbLine: lines[2],
    forgedSelectorLine: lines[3], revokedDenialLine: lines[4],
    victimIdOrderingLine: lines[5],
    sourcePageBlobSha: t.pageSha, proofBlobSha: t.proofSha,
    contractFile: t.contract, contractBlobSha: t.contractSha,
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
function reason(t) {
  return "SOLO_VERIFIED_DEV_RECOVERY: provisional source-current fictional PG16 " +
    "authenticated Next SSR/HTTP proof of a populated own employer 200; real higher-ID " +
    "foreign employer or worker/process 404; forged/duplicate or revoked selector refusal; " +
    "and byte-identical victim business/payroll/audit SQL. Exact-final-head PG16 test is required; " +
    "no API method, independent HR/privacy/security, production or money authorization. " +
    "Not tested: " + t.notTested + ".";
}
const NOTE_PREFIX = " Six page-only SOLO_VERIFIED_DEV_RECOVERY candidates:";
export function expectedSixPageManifest(input, read = readFileSync) {
  const {selected, anchors} = verifySixInputs(read);
  const m = structuredClone(input);
  assert.equal(m.scopedPages.length, 21, "SIX_PAGE_REFUSED: original 21 pages changed");
  for (const t of TARGETS) {
    const row = m.scopedPages.find(p => p.path === t.path);
    assert.ok(row && row.blob === t.pageSha && row.hasAction === false,
      "SIX_PAGE_REFUSED: wrong identity/blob/action " + t.path);
    if (!selected.includes(t)) {
      assert.equal(row.status, "GAP", "SIX_PAGE_REFUSED: unproved page promoted " + t.path);
      assert.equal(row.testedBy, undefined, "SIX_PAGE_REFUSED: old receipt on unproved " + t.path);
      continue;
    }
    const previous = row.status === "GAP" ? row.reason : row.testedBy?.previousGapReason;
    const expected = makeCitation(t, previous, anchors.get(t.key));
    if (row.status === "GAP") {
      assert.equal(row.testedBy, undefined, "SIX_PAGE_REFUSED: hidden stale credit");
      row.status = "COVERED";
      row.reason = reason(t);
      row.testedBy = expected;
    } else {
      assert.equal(row.status, "COVERED", "SIX_PAGE_REFUSED: unknown classification");
      assert.equal(row.reason, reason(t), "SIX_PAGE_REFUSED: reason drift");
      assert.deepEqual(row.testedBy, expected, "SIX_PAGE_REFUSED: evidence drift " + t.path);
    }
  }
  const methods = Object.values(m.allApiRouteFiles).flatMap(entry => entry.methods);
  m.metrics.routeFiles = Object.keys(m.allApiRouteFiles).length;
  m.metrics.methods = methods.length;
  for (const [name, status] of [
    ["coveredAfter", "COVERED"], ["gap", "GAP"],
    ["publicByDesign", "PUBLIC-BY-DESIGN"],
    ["privilegedOperationsTokenOnly", "PRIVILEGED-OPERATIONS-TOKEN-ONLY"],
  ]) m.metrics[name] = methods.filter(p => p.status === status).length;
  m.metrics.scopedPagesAndActions = m.scopedPages.length;
  const covered = m.scopedPages.filter(p => p.status === "COVERED").length;
  const open = m.scopedPages.filter(p => p.status === "GAP").length;
  assert.equal(covered, 10 + selected.length, "SIX_PAGE_REFUSED: unrelated coverage changed");
  assert.equal(open, 11 - selected.length, "SIX_PAGE_REFUSED: unrelated gap changed");
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED: \d+ API methods and \d+ page\/action GAPs/);
  m.acceptanceStatus = m.acceptanceStatus.replace(
    /^NOT ACCEPTED: \d+ API methods and \d+ page\/action GAPs/,
    "NOT ACCEPTED: " + m.metrics.gap + " API methods and " + open + " page/action GAPs");
  const note = NOTE_PREFIX + " " + covered + "/21 provisional COVERED, " + open +
    " GAP; exact-head PG16 jobs remain required; no API-method credit, " +
    "independent approval, payroll, provider or production activation.";
  m.acceptanceStatus = m.acceptanceStatus.split(NOTE_PREFIX)[0] + note;
  return m;
}
export function historicSixPageView(input, read = readFileSync) {
  const {selected, anchors} = verifySixInputs(read);
  const m = structuredClone(input);
  for (const t of selected) {
    const row = m.scopedPages.find(p => p.path === t.path);
    assert.equal(row?.status, "COVERED", "SIX_PAGE_REFUSED: missing selected page");
    assert.equal(row.reason, reason(t), "SIX_PAGE_REFUSED: reason altered");
    assert.deepEqual(row.testedBy, makeCitation(t, row.testedBy?.previousGapReason,
      anchors.get(t.key)), "SIX_PAGE_REFUSED: unproven source receipt");
    row.reason = row.testedBy.previousGapReason;
    row.status = "GAP";
    delete row.testedBy;
  }
  assert.equal(m.scopedPages.filter(p => p.status === "COVERED").length, 10);
  assert.equal(m.scopedPages.filter(p => p.status === "GAP").length, 11);
  m.acceptanceStatus = m.acceptanceStatus.split(NOTE_PREFIX)[0].replace(
    /^NOT ACCEPTED: \d+ API methods and \d+ page\/action GAPs/,
    "NOT ACCEPTED: " + m.metrics.gap + " API methods and 11 page/action GAPs");
  return m;
}
export function verifySixPageCredits(m, read = readFileSync) {
  assert.deepEqual(m, expectedSixPageManifest(m, read),
    "SIX_PAGE_REFUSED: manifest must be generator-exact");
  const historical = historicSixPageView(m, read);
  assert.equal(verifyFivePageCredits(historical, read), 5,
    "SIX_PAGE_REFUSED: prior five page credits must still pass unchanged");
  return selectedTargets(read).length;
}
function main() {
  assert.ok(process.argv.length === 3 &&
    ["--write", "--check"].includes(process.argv[2]),
    "SIX_PAGE_REFUSED: --write/--check only");
  const raw = readFileSync(MANIFEST, "utf8");
  const expected = expectedSixPageManifest(JSON.parse(raw));
  const output = JSON.stringify(expected, null, 2) + "\n";
  if (process.argv[2] === "--write") writeFileSync(MANIFEST, output);
  else assert.equal(raw, output, "SIX_PAGE_REFUSED: manifest not generated");
  assert.equal(verifySixPageCredits(expected), selectedTargets().length);
  console.log(JSON.stringify({
    evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY", beforeCovered: 10, beforeGaps: 11,
    afterCovered: expected.scopedPages.filter(p => p.status === "COVERED").length,
    afterGaps: expected.scopedPages.filter(p => p.status === "GAP").length,
    newApiMethodCredits: 0, selected: selectedTargets().map(p => p.key),
    exactFinalHeadCiRequired: true, independentlyAccepted: false,
    productionCertified: false
  }));
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-six-scoped-page-credit.mjs"))
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
