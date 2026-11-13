#!/usr/bin/env node
/**
 * Fail-closed source/receipt/line verification for the November 4 five-method
 * solo-owner PG16 recovery. Verification is historical final-proof-head,
 * not new tenant-wide CI acceptance or a request to run real payroll.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertLiveTenantCounts } from "../../tests/helpers/tenant-counts.mjs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const ROOT = "src/app/api/";
const RUN = "https://github.com/erwinmehehe/payrollph/actions/runs/";
export const EVIDENCE = Object.freeze([
  {
    route: "self/profile", method: "PATCH", pr: 1762,
    head: "8b915bc17574b87ff707258bff827265866bbaea",
    run: 41830570387, job: 126576391067,
    routeSha: "41d26b23678e8822aff4701a611c429e97f659c3",
    file: "scripts/qa/tenant-self-profile-atomic-http.mjs",
    fileSha: "5464195dc5021833751cc2cb05b1db0e1aacdbf3",
    contract: "tests/tenant-self-profile-contract.test.mjs",
    contractSha: "894554479e0069ce76a1737daa1852e0caeea077",
    workflow: ".github/workflows/tenant-self-profile-http.yml",
    workflowSha: "b69b93889d7e4a42c2d842cc1a8328eb56e26187",
    anchors: [
      ["ownPositiveLine", 193, "const actual = await checked(ENDPOINT, {"],
      ["foreignDenialLine", 310, "const revoked = await checked(ENDPOINT"],
      ["forgedSelectorLine", 205, "const forged = await checked(ENDPOINT"],
      ["unchangedDbLine", 150, "assert.deepEqual(await snapshot(victim.org.id), victimBefore"],
    ],
    extra: [
      ["unchangedVictimCallLine", 320, 'await unchangedVictim("membership revoked'],
      ["auditRollbackLine", 284, "assert.deepEqual(await snapshot(first.org.id), beforeAuditVeto"],
      ["realVictimPayrollEntryLine", 139, "assert.equal(victimSeeded.payrollEntries.length, 1"],
    ],
  },
  {
    route: "hcm/salary-corrections/preview", method: "POST", pr: 1762,
    head: "8b915bc17574b87ff707258bff827265866bbaea",
    run: 41830569945, job: 126576389367,
    routeSha: "8abc2b8059a403b81bf24c78108445651be4690a",
    file: "scripts/qa/tenant-hcm-salary-correction-preview-http.mjs",
    fileSha: "225f39f63b8365447b23eba22271fc97adad9362",
    contract: "tests/tenant-hcm-salary-correction-preview-contract.test.mjs",
    contractSha: "68e68dc9dff3a6bc51801c525a7d241b7abb3ab5",
    workflow: ".github/workflows/tenant-hcm-salary-correction-preview.yml",
    workflowSha: "7cbb0a6a0389a4eb0f22cce61c34ed90939c5a97",
    anchors: [
      ["ownPositiveLine", 204, "const ownA = await call(a, bodyFor(a));"],
      ["foreignDenialLine", 221, 'name: "higher-ID real foreign employer"'],
      ["forgedSelectorLine", 223, 'name: "forged higher-ID victim legal employer and employee"'],
      ["unchangedDbLine", 240, "assert.deepEqual(await snapshots(), before"],
    ],
    extra: [
      ["secondOwnPositiveLine", 206, "const ownB = await call(b, bodyFor(b));"],
      ["revokedGrantDenialLine", 254, "const revoked = await call(a, bodyFor(a));"],
    ],
  },
  {
    route: "invitations", method: "POST", pr: 1762,
    head: "8b915bc17574b87ff707258bff827265866bbaea",
    run: 41830569741, job: 126576388593,
    routeSha: "59bdded07a33d7c4dbc394a84135ce99f9f04042",
    file: "scripts/qa/tenant-invitations-post-boundary.mjs",
    fileSha: "4bf5a91c547aa8faf39a1411991e30f893508154",
    contract: "tests/tenant-invitations-post-boundary.test.mjs",
    contractSha: "f01af351f75a3a7cd24d5f685ecd2f684cdecf91",
    workflow: ".github/workflows/tenant-invitations-post-boundary.yml",
    workflowSha: "07367c81d79903935882f35726fb508c73c0ec5a",
    anchors: [
      ["ownPositiveLine", 298, 'const realPost=await call(owner,owner,"POST");'],
      ["foreignDenialLine", 256, 'const post=await call(attacker,victim,"POST");'],
      ["forgedSelectorLine", 272, 'const forgedUnit=await http.standaloneRequest("/api/invitations"'],
      ["unchangedDbLine", 263, "proveUnchanged(before[i],await snapshot(employers[i].org.id)"],
    ],
    extra: [
      ["allInvitableRolesLine", 385, "assert.equal(created.status,201"],
      ["realVictimIdAboveSixLine", 681, "genuineVictimInvitationIdAboveSix:true"],
      ["revokedOwnerDenialLine", 658, "assert.equal(deniedRevokedOwner.status,403"],
    ],
  },
]);

function gitBlobSha(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update(Buffer.from("blob " + data.length + "\0"))
    .update(data).digest("hex");
}
function findMethod(manifest, route, verb) {
  return manifest.allApiRouteFiles[ROOT + route + "/route.ts"]?.methods.find(m => m.name === verb);
}

/**
 * Fail closed on page-credit drift without blocking the original 17-GAP
 * baseline. Only the exact Worker 360 SSR worker-bound proof can propose a
 * single 17 -> 16 page-gap reduction; API method credits are unaffected.
 * A provisional ledger status is NOT independent human security acceptance.
 */
export function verifyWorker360PageCredit(
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8")),
  read = path => readFileSync(path),
) {
  const name = "src/app/hcm/worker-360/page.tsx";
  const row = manifest.scopedPages.find(entry => entry.path === name);
  const gaps = manifest.scopedPages.filter(entry => entry.status === "GAP").length;
  assert.ok(row, "Worker 360 scoped page must stay in the inventory");
  if (row.status === "GAP") {
    assert.equal(gaps, 17, "Only Worker 360 may lose provisional page credit");
    const currentPageSha = "3b506b27e0af73ec370c448c6a0ad02a80c8f75c";
    const currentApiSha = "19875021d750b722fc69e0fe939e57928a158af9";
    const blob = data => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      return gitBlobSha(buf);
    };
    assert.equal(row.blob, currentPageSha);
    assert.equal(blob(read(name)), currentPageSha, "Worker 360 page must be exact revised source");
    assert.equal(row.testedBy, undefined, "Historical page receipt cannot certify changed source");
    assert.equal(row.reviewedUncertified?.kind,
      "worker360-legal-employer-source-supersession-zero-credit");
    assert.equal(row.reviewedUncertified?.coverageCredits, 0);
    const api = manifest.allApiRouteFiles["src/app/api/hcm/worker-360/route.ts"];
    assert.equal(api?.gitBlobSha, currentApiSha);
    assert.equal(blob(read("src/app/api/hcm/worker-360/route.ts")), currentApiSha);
    const get = api.methods.find(method => method.name === "GET");
    assert.equal(get?.status, "GAP", "Changed API GET cannot inherit old PG16 receipt");
    assert.equal(get?.testedBy, null);
    assert.equal(get?.reviewedUncertified?.coverageCredits, 0);
    const pageSource = read(name).toString("utf8");
    const apiSource = read("src/app/api/hcm/worker-360/route.ts").toString("utf8");
    for (const source of [pageSource, apiSource]) {
      assert.ok(source.includes("resolveMultiEntityContext("),
        "Legal-employer policy must run before worker reads");
      assert.ok(source.includes("authorizedLegalEntityId"),
        "Selected legal employer must bind the worker query");
    }
    return gaps;
  }
  assert.equal(row.status, "COVERED", "No unreviewed alternate page classification");
  assert.equal(gaps, 16, "Only the exact Worker 360 page GAP may close");
  const pageSha = "337034f839c17a30077e2cfe5991c640e0c6a5e9";
  const proofSha = "7a342f1499399f0209a98e845ca3fe21b8db39b3";
  const proofFile = "scripts/qa/tenant-hcm-worker360-http.mjs";
  const pageSource = read(name).toString("utf8");
  const proofSource = read(proofFile).toString("utf8");
  assert.equal(row.blob, pageSha);
  assert.equal(gitBlobSha(Buffer.from(pageSource)), pageSha, "Worker 360 SSR source changed");
  assert.equal(row.testedBy?.sourceBlobSha, pageSha);
  assert.equal(row.testedBy?.file, proofFile);
  assert.equal(row.testedBy?.proofBlobSha, proofSha);
  assert.equal(gitBlobSha(Buffer.from(proofSource)), proofSha,
    "Worker 360 PG16 proof changed; renew exact-head run");
  assert.equal(row.testedBy?.independentSecurityReview, "PENDING");
  assert.equal(row.testedBy?.productionCertified, false);
  assert.match(row.reason, /^PROVISIONAL exact-employee-bound Worker 360 SSR shell:/);
  assert.match(pageSource, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(pageSource, /eq\(employees\.id, employeeId\)/);
  assert.match(pageSource, /if \(!verifiedWorker\) notFound\(\)/);
  const auth = pageSource.indexOf("await assertOrganizationRole(");
  const plan = pageSource.indexOf("await denyOptInEnterpriseHcmPlan(");
  const employee = pageSource.indexOf("const [verifiedWorker] = await db.select(");
  const mount = pageSource.indexOf("<Worker360Client");
  assert.ok(auth > 0 && auth < plan && plan < employee && employee < mount,
    "Page must authorize employer, role and plan before querying own employee");
  const lines = proofSource.split("\n");
  for (const [field, marker, number] of [
    ["ownPositiveLine", "await readPage(actor, actor.worker, actor.cookie)", 176],
    ["foreignDenialLine", "await deny(pagePath(actor.org.id, victim.worker.id)", 209],
    ["unchangedDbLine", "assertUnchangedSql(baselines.get(actor.org.id)", 147],
  ]) {
    assert.equal(row.testedBy[field], number, field + " page closure source pin");
    assert.ok(lines[number - 1]?.includes(marker), field + " real HTTP evidence missing");
  }
  for (const evidence of [
    "for (const actor of [a, b])",
    "await readPage(actor, actor.secondWorker, actor.cookie)",
    "foreign worker inside own employer SSR",
    "other attacker's worker inside own employer SSR",
    "assert.equal(ownedPages, 5",
    "assert.equal(foreignDenials, 12",
    "assert.equal(deniedCases, 44",
  ]) assert.ok(proofSource.includes(evidence),
    "Missing required two-employer employee-bound SSR control: " + evidence);
  const workflow = read(".github/workflows/tenant-hcm-worker360-qa.yml").toString("utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-worker360-http\.mjs/);
  const api = manifest.allApiRouteFiles["src/app/api/hcm/worker-360/route.ts"];
  assert.equal(api?.gitBlobSha, "78874e3800c9648b2e9e8895a4c0f1b2db9e2e62");
  assert.equal(api.methods.find(method => method.name === "GET")?.status, "COVERED");
  return gaps;
}

export function verifyFiveMethodCredits(
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8")),
  read = path => readFileSync(path),
) {
  // Keep live ledger totals derived from actual method statuses, never pinned
  // to the counts of this historical proof batch. Compare to the base when
  // the CI checkout provides origin/main.
  const { live } = assertLiveTenantCounts(assert, manifest);
  const pageActionGaps = verifyWorker360PageCredit(manifest, read);

  for (const e of EVIDENCE) {
    const path = ROOT + e.route + "/route.ts";
    const entry = manifest.allApiRouteFiles[path];
    assert.equal(entry?.gitBlobSha, e.routeSha, path + " route pin");
    const m = findMethod(manifest, e.route, e.method);
    assert.equal(m?.status, "COVERED", e.method + " " + e.route);
    assert.equal(m?.reviewedUncertified, undefined, "Do not leave a stale zero-credit hold");
    const p = m.testedBy;
    assert.ok(p);
    assert.equal(p.file, e.file);
    assert.equal(p.proofFile, e.file);
    assert.equal(p.routeBlobSha, e.routeSha);
    assert.equal(p.proofBlobSha, e.fileSha);
    assert.equal(p.contractFile, e.contract);
    assert.equal(p.contractBlobSha, e.contractSha);
    assert.equal(p.workflowFile, e.workflow);
    assert.equal(p.workflowBlobSha, e.workflowSha);
    assert.equal(p.proofPullRequest, e.pr);
    assert.equal(p.proofHeadSha, e.head);
    assert.equal(p.verifiedPrHeadSha, e.head);
    assert.equal(p.workflowRunId, e.run);
    assert.equal(p.workflowJobId, e.job);
    assert.equal(p.evidence, RUN + e.run + "/job/" + e.job);
    assert.equal(p.postgresMajor, 16);
    assert.equal(p.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(p.ownerReviewer, "erwinmehehe");
    assert.equal(p.ownerIsOnlyReviewer, true);
    assert.equal(p.ownerAcceptance, "PENDING");
    assert.equal(p.independentlyAccepted, false);
    assert.equal(p.independentSecurityReview, "PENDING");
    assert.equal(p.productionTested, false);
    assert.equal(p.productionCertified, false);
    assert.match(m.reason, /SOLO_VERIFIED_DEV_RECOVERY/);
    for (const [f, sha] of [[path, e.routeSha], [e.file, e.fileSha],
      [e.contract, e.contractSha], [e.workflow, e.workflowSha]]) {
      assert.equal(gitBlobSha(read(f)), sha,
        f + " source differs from passing final head: renew real PG16 HTTP proof");
    }
    assert.equal(p.line, p.ownPositiveLine);
    const proof = read(e.file).toString().split("\n");
    for (const [field, number, text] of [...e.anchors, ...e.extra]) {
      assert.equal(p[field], number, e.route + " " + field);
      assert.ok((proof[number - 1] ?? "").includes(text),
        e.route + " " + field + " is not an executed exact source citation");
    }
    const workflow = read(e.workflow).toString();
    assert.match(workflow, /postgres:16/, e.route + " disposable PG16");
    for (const flag of ["NEXT_CSP_ENABLED", "XENDIT_BILLING_ENABLED"]) {
      assert.match(workflow, new RegExp(flag + "(?:=|:\\s*[\'\\\"]?)false"), e.route + " must keep " + flag + " OFF");
    }
  }
  const transferPath = ROOT + "multi-entity/transfers/route.ts";
  const transfers = manifest.allApiRouteFiles[transferPath];
  assert.equal(transfers?.gitBlobSha, "a4ac9ec92df17492c4c0918f08114660bc4c6ebe");
  let transfersHeld = 0;
  for (const method of ["POST", "PATCH"]) {
    const m = transfers.methods.find(m => m.name === method);
    if (m?.status === "COVERED") {
      // The later dedicated two-attacker proof (#1853) supersedes the uncredited Playwright candidate. Any other
      // COVERED claim, including the old candidate file, must still fail closed.
      const t = m.testedBy;
      assert.equal(t?.file, "scripts/qa/tenant-transfers-http.mjs", method + " transfer credit must come from the dedicated proof");
      assert.equal(t.proofPullRequest, 1853, method + " transfer credit proof owner");
      assert.equal(t.workflowRunId, 42480658953, method + " transfer credit executed run");
      assert.equal(t.workflowJobId, 128731654457, method + " transfer credit executed job");
      assert.equal(t.verifiedPrHeadSha, "538c70b05588d1aae223e32d11230cb5a715afdf");
      assert.equal(t.mergedProofCommit, "073e23f019c00fc6638e2c2854a22a7fda4281b0");
      assert.equal(t.routeBlobSha, transfers.gitBlobSha, method + " transfer proof was written against this exact route");
      assert.equal(t.independentSecurityReview, "PENDING");
      assert.equal(t.independentlyAccepted, false, method + " transfer credit is not independent acceptance");
      assert.equal(t.productionTested, false);
      assert.equal(t.line, t.ownPositiveLine);
      assert.equal(m.reviewedUncertified, undefined, method + " the superseded candidate hold is removed, not kept beside a credit");
      for (const [field, file] of [["proofBlobSha", "scripts/qa/tenant-transfers-http.mjs"], ["contractBlobSha", "scripts/qa/tenant-transfers-contract.mjs"],
        ["testBlobSha", "tests/tenant-transfers-contract.test.mjs"], ["workflowBlobSha", ".github/workflows/tenant-transfers-http.yml"]]) {
        assert.equal(t[field], gitBlobSha(read(file)), method + " transfer proof source drift requires fresh PG16 evidence: " + file);
      }
      const proofLines = read("scripts/qa/tenant-transfers-http.mjs").toString().split("\n");
      for (const field of ["ownPositiveLine", "foreignDenialLine", "unchangedDbLine"]) {
        assert.ok(Number.isSafeInteger(t[field]) && t[field] > 0 && t[field] <= proofLines.length, method + " " + field);
      }
      continue;
    }
    transfersHeld++;
    assert.equal(m?.status, "GAP", "incomplete " + method + " transfer proof cannot be counted");
    assert.equal(m?.testedBy, null);
    assert.equal(m?.reviewedUncertified?.coverageCredits, 0);
    // Merged #1762 superseded #1711's review-only transfer references.
    // Neither source-identical proof changes the transfer GAP classification.
    const review = m.reviewedUncertified;
    assert.equal(review?.kind, "multi-entity-transfers-typed-conflict-PG16-fault-proof-uncredited");
    assert.equal(review?.routeBlobSha, transfers.gitBlobSha);
    assert.equal(review?.exactHeadPg16Http, "PENDING");
    assert.equal(review?.productionCertified, false);
    assert.equal(review?.reconciliationReview?.fullMethodCoverageCredits, 0);
    for (const [fileField, shaField, file, sha] of [
      ["proofFile", "proofBlobSha", "scripts/qa/tenant-multi-entity-transfers-write-http.mjs",
        "f628eb48ac5bd0064c7da5915d8b51c990ab3a32"],
      ["contractFile", "contractBlobSha", "tests/tenant-multi-entity-transfers-write-candidate.test.mjs",
        "98015ffb48b1832c5f618405b1c9b230e99876bb"],
      ["workflowFile", "workflowBlobSha", ".github/workflows/multi-entity-browser-qa.yml",
        "ae71b132c1e495f58a0589a5fc44a956e85fc924"],
    ]) {
      assert.equal(review?.[fileField], file, method + " transfer proof path");
      assert.equal(review?.[shaField], sha, method + " transfer proof SHA");
      if (file === ".github/workflows/multi-entity-browser-qa.yml") assertOracleCallerCompatible(file, sha, read);
      else assert.equal(gitBlobSha(read(file)), sha,
        method + " transfer proof source drift requires fresh PG16 evidence");
    }
    assert.match(m.reason, /PR #1762 adds a stricter source-pinned synthetic PG16 recovery candidate/);
    assert.match(m.reason, /two independent own-employer successes/);
    assert.match(m.reason, /higher-ID victim transfer/);
  }
  return { status: "PASS", label: "SOLO_VERIFIED_DEV_RECOVERY", methodsCredited: 3,
    methodsHeld: transfersHeld, covered: live.coveredAfter, publicByDesign: live.publicByDesign, gap: live.gap, pageActionGaps,
    productionTested: false, independentlyAccepted: false };
}

if (process.argv[1]?.endsWith("/tenant-five-method-credit-verify.mjs")) {
  console.log(JSON.stringify(verifyFiveMethodCredits()));
}
import {assertOracleCallerCompatible} from './payroll-run-oracle-source-compat.mjs';
