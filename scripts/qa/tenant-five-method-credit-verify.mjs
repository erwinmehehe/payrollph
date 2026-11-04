#!/usr/bin/env node
/**
 * Fail-closed source/receipt/line verification for the November 4 five-method
 * solo-owner PG16 recovery. Verification is historical final-proof-head,
 * not new tenant-wide CI acceptance or a request to run real payroll.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const ROOT = "src/app/api/";
const RUN = "https://github.com/erwinmehehe/payrollph/actions/runs/";
export const EVIDENCE = Object.freeze([
  {
    route: "self/profile", method: "PATCH", pr: 1739,
    head: "3c5b88f2298dae8d2c3d68824cae2590e6e386f7",
    run: 41751126605, job: 126316178623,
    routeSha: "41d26b23678e8822aff4701a611c429e97f659c3",
    file: "scripts/qa/tenant-self-profile-atomic-http.mjs",
    fileSha: "9a42da956c03c643fbe744a626d796055c57e48d",
    contract: "tests/tenant-self-profile-contract.test.mjs",
    contractSha: "894554479e0069ce76a1737daa1852e0caeea077",
    workflow: ".github/workflows/tenant-self-profile-http.yml",
    workflowSha: "f87cf4434859281fad052d8baa920677c5dd37af",
    anchors: [
      ["ownPositiveLine", 186, "const actual = await checked(ENDPOINT, {"],
      ["foreignDenialLine", 303, "const revoked = await checked(ENDPOINT"],
      ["forgedSelectorLine", 198, "const forged = await checked(ENDPOINT"],
      ["unchangedDbLine", 143, "assert.deepEqual(await snapshot(victim.org.id), victimBefore"],
    ],
    extra: [
      ["unchangedVictimCallLine", 313, 'await unchangedVictim("membership revoked'],
      ["auditRollbackLine", 277, "assert.deepEqual(await snapshot(first.org.id), beforeAuditVeto"],
      ["realVictimPayrollEntryLine", 132, "assert.equal(victimSeeded.payrollEntries.length, 1"],
    ],
  },
  {
    route: "hcm/salary-corrections/preview", method: "POST", pr: 1738,
    head: "d151d1af761448b1dacf887772bbad258579c770",
    run: 41632939949, job: 125906823417,
    routeSha: "8abc2b8059a403b81bf24c78108445651be4690a",
    file: "scripts/qa/tenant-hcm-salary-correction-preview-http.mjs",
    fileSha: "8a5c8ea4e9ad64896b4051963fc17a374a2ee4c4",
    contract: "tests/tenant-hcm-salary-correction-preview-contract.test.mjs",
    contractSha: "68e68dc9dff3a6bc51801c525a7d241b7abb3ab5",
    workflow: ".github/workflows/tenant-hcm-salary-correction-preview.yml",
    workflowSha: "7cbb0a6a0389a4eb0f22cce61c34ed90939c5a97",
    anchors: [
      ["ownPositiveLine", 194, "const ownA = await call(a, bodyFor(a));"],
      ["foreignDenialLine", 211, 'name: "higher-ID real foreign employer"'],
      ["forgedSelectorLine", 213, 'name: "forged higher-ID victim legal employer and employee"'],
      ["unchangedDbLine", 230, "assert.deepEqual(await snapshots(), before"],
    ],
    extra: [
      ["secondOwnPositiveLine", 196, "const ownB = await call(b, bodyFor(b));"],
      ["revokedGrantDenialLine", 244, "const revoked = await call(a, bodyFor(a));"],
    ],
  },
  {
    route: "invitations", method: "POST", pr: 1746,
    head: "ed11da91a632ae3016e9f55328f8d46cf1f1d18d",
    run: 41751301676, job: 126316754844,
    routeSha: "59bdded07a33d7c4dbc394a84135ce99f9f04042",
    file: "scripts/qa/tenant-invitations-post-boundary.mjs",
    fileSha: "cd28c687e4b0a1a9012746cb2beb5cf0c603bed5",
    contract: "tests/tenant-invitations-post-boundary.test.mjs",
    contractSha: "eb1bcb01f0c60d8b87836b60471ea0f2e5d89217",
    workflow: ".github/workflows/tenant-invitations-post-boundary.yml",
    workflowSha: "8f8ac8954544e6e7b5128b6202c7ad621b217d6a",
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
export function verifyFiveMethodCredits(
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8")),
  read = path => readFileSync(path),
) {
  const tally = { COVERED: 0, "PUBLIC-BY-DESIGN": 0, GAP: 0 };
  for (const file of Object.values(manifest.allApiRouteFiles)) {
    for (const method of file.methods) {
      assert.ok(Object.hasOwn(tally, method.status), "Unknown method status");
      tally[method.status]++;
    }
  }
  assert.deepEqual(tally, { COVERED: 410, "PUBLIC-BY-DESIGN": 10, GAP: 78 });
  assert.equal(manifest.metrics.methods, 498);
  assert.equal(manifest.metrics.routeFiles, 295);
  assert.equal(manifest.metrics.coveredAfter, 410);
  assert.equal(manifest.metrics.publicByDesign, 10);
  assert.equal(manifest.metrics.gap, 78);
  assert.equal(manifest.scopedPages.filter(p => p.status === "GAP").length, 17);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED: 78 API methods and 17 page\/action GAPs/);

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
  for (const method of ["POST", "PATCH"]) {
    const m = transfers.methods.find(m => m.name === method);
    assert.equal(m?.status, "GAP", "incomplete " + method + " transfer proof cannot be counted");
    assert.equal(m?.testedBy, null);
    assert.equal(m?.reviewedUncertified?.coverageCredits, 0);
    assert.ok(m.reason.includes("41407277583"), "re-pin current-source passing #1711 evidence");
    assert.match(m.reason, /two independently owned employers/);
  }
  return { status: "PASS", label: "SOLO_VERIFIED_DEV_RECOVERY", methodsCredited: 3,
    methodsHeld: 2, covered: 410, publicByDesign: 10, gap: 78, pageActionGaps: 17,
    productionTested: false, independentlyAccepted: false };
}

if (process.argv[1]?.endsWith("/tenant-five-method-credit-verify.mjs")) {
  console.log(JSON.stringify(verifyFiveMethodCredits()));
}
