/**
 * Non-credentialled, source-only guard on six merged proof candidates.
 * Keeps historical coverage + live metrics unchanged until the exact four-part
 * contract is satisfied on a final-head, independent PG16 HTTP run.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyPayoutProfileCredit } from "../scripts/qa/tenant-payout-profile-credit.mjs";
import { EVIDENCE, verifyFiveMethodCredits } from "../scripts/qa/tenant-five-method-credit-verify.mjs";

const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const cases = [
  ["POST", "bir/annual-employer/candidate", 1676, "abe1600a2df31f513cda152bed828fd5567fd72e",
    "b0344f6af31b58456772cd46a07af46291c11ad0", 136, 153, 157, 170, 68, "object ID > 6"],
  ["POST", "leave/conversion", 1675, "b16f4adfdf6c6dc14813360045bb8f0efaf10892",
    "bc90fac8e0023c4e8f8d879c31447bd4f666787f", 111, 128, 130, 141, 96, "victim"],
  ["POST", "payroll/overpayment-preflight", 1674, "ec0e8b081c52bb8b22b7911c886c2005e45312f2",
    "24a475e0c695a97789d01b22da22ebd3d361f3f6", 84, 95, 99, 114, 58, "victim"],
  ["POST", "multi-entity/transfers", 1662, "c7001c59b9f60b55192bfb1d1876a18e0f18f482",
    "21909753364cda9cead239a8a495b1e2a40abc9d", 139, 153, 160, 224, 131, "Two independent own-employer"],
  ["PATCH", "multi-entity/transfers", 1662, "c7001c59b9f60b55192bfb1d1876a18e0f18f482",
    "21909753364cda9cead239a8a495b1e2a40abc9d", 176, 156, 166, 224, 131, "Two independent own-employer"],
  ["PATCH", "compliance/filing-validations/[id]", 1501, "893977583b4ac7e4d49da5b03327f7bc5c8e4a53",
    "c7e0660e218646d5848e56c3e60aaeb0b283f4b4", 112, 125, 129, 149, 74, "accepted-outcome"],
];
const skipOpenCredit = new Set(["POST leave/conversion", "POST payroll/overpayment-preflight"]);
const blobSha = filename => {
  const data = readFileSync(filename);
  return createHash("sha1").update(Buffer.from("blob " + data.length + "\0")).update(data).digest("hex");
};
const allMethods = Object.entries(m.allApiRouteFiles).flatMap(([path, value]) =>
  value.methods.map(method => ({ path, method })));
const inventory = readFileSync("docs/engineering/tenant-isolation-coverage-inventory.md", "utf8");
const plan = readFileSync("docs/engineering/tenant-isolation-closure-plan.md", "utf8");

test("four uncredited methods stay GAP; two main-owned provisional credits are preserved", () => {
  assert.equal(cases.length, 6);
  for (const [verb, route, pr, head, proofSha, own, foreign, forged, unchanged, ordering, missing] of cases) {
    const path = "src/app/api/" + route + "/route.ts";
    const entry = m.allApiRouteFiles[path];
    assert.ok(entry, path);
    const method = entry.methods.find(row => row.name === verb);
    const label = verb + " " + route;
    if (skipOpenCredit.has(label)) {
      // #1727 has now merged these two source-matched provisional credits to
      // main. This review must leave their existing proof and credit untouched.
      assert.equal(method?.status, "COVERED", label + ": preserve already-merged main credit");
      assert.equal(method.testedBy?.proofHeadSha, head, label + " original verified head");
      assert.equal(method.testedBy?.proofBlobSha, proofSha, label + " original proof bytes");
      assert.equal(method.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
      assert.equal(method.testedBy?.independentlyAccepted, false);
      assert.equal(method.testedBy?.productionCertified, false);
      assert.equal(method.reviewedUncertified, undefined, label + ": no new method review metadata");
      const skippedRow = inventory.split("\n").find(line =>
        line.includes("[`" + route + "` " + verb + "]("));
      assert.ok(skippedRow?.includes("**COVERED**") && skippedRow.includes("PG16 own POST"),
        label + ": inventory must keep main's existing provisional proof");
      continue;
    }
    assert.equal(method?.status, "GAP", label);
    assert.equal(method.testedBy, null, label + " must never borrow a partial receipt");
    assert.match(method.reason, /Still GAP:/, label);
    const review = method.reviewedUncertified?.reconciliationReview;
    assert.ok(review && typeof review === "object", label);
    assert.equal(review.proofPr, pr, label);
    assert.equal(review.proofFinalHead, head, label);
    assert.match(review.passedJob, /https:\/\/github\.com\/erwinmehehe\/payrollph\/actions\/runs\/\d+\/job\/\d+$/, label);
    assert.equal(review.proofBlobShaAtFinalHead, proofSha, label);
    if (pr === 1662) {
      // Historical #1662 source is superseded by merged #1711, not a current credit.
      assert.equal(review.reviewedRouteBlobSha,
        method.reviewedUncertified.originalRouteBlobSha, label + " historical route");
      assert.equal(method.reviewedUncertified.routeBlobSha, entry.gitBlobSha,
        label + " current source pin");
      assert.equal(blobSha(method.reviewedUncertified.proofFile),
        method.reviewedUncertified.proofBlobSha, label + " newer uncredited fault proof");
      assert.notEqual(blobSha(review.proofFile), proofSha,
        label + " historical receipt must not be reused as current proof");
    } else {
      assert.equal(review.reviewedRouteBlobSha, entry.gitBlobSha, label);
    }
    assert.equal(blobSha(path), entry.gitBlobSha, label + " route changed since review");
    assert.equal(review.fullMethodCoverageCredits, 0, label);
    assert.equal(review.independentReview, "PENDING", label);
    assert.equal(review.productionTested, false, label);
    assert.ok(review.missingParts.join(" ").includes(missing), label + " missing-part text");
    assert.deepEqual(review.sourceAnchors,
      { ownPositiveLine:own, foreignDenialLine:foreign, forgedSelectorLine:forged,
        unchangedDbLine:unchanged, victimIdOrderingLine:ordering }, label + " source anchors drifted");
    const proofPath = review.sharedRunner ?? review.proofFile;
    const lines = readFileSync(proofPath, "utf8").split("\n");
    if (pr === 1676) {
      // The #1676 hashes and line numbers remain HISTORICAL metadata. The
      // current BIR runner has new, UNACCEPTED real-HTTP check/download paths.
      // Never silently pretend its new lines were the exact merged #1676 head.
      assert.equal(blobSha(proofPath), "565e609167a4cd8e6df21c099ad5d15fe9a94f6e",
        "BIR recovery candidate changed: obtain new exact-head PG16 proof first");
      assert.notEqual(blobSha(proofPath), proofSha,
        "a changed recovery runner cannot borrow the template-only #1676 job");
      const current = lines.join("\n");
      for (const evidence of [
        'for (const name of ["ATTA", "ATTB", "VICTIM"])',
        'victim.org.id > 6 && victim.worker.id > 6 && victim.entity.id > 6',
        'const checked = expect(await e.context.post(',
        'const downloaded = expect(await e.context.post(',
        'actualSha === checkResult.fileSha256',
        'for (const mode of ["template", "check", "download"])',
        'legalEntityId: victim.entity.id',
        'employeeNo: victim.worker.employeeNo',
        'assert.deepEqual(await snapshot(victim), before.get(victim.org.id)',
        'assert.deepEqual(await snapshot(attacker), before.get(attacker.org.id)',
        'owned === 3 && ownedChecks === 3 && ownedDownloads === 3',
        'denied === 16',
        'credits: 0',
      ]) assert.ok(current.includes(evidence),
        "New BIR recovery source lost a required real-HTTP guard: " + evidence);
    } else if (pr === 1662) {
      // Old line anchors remain only historical citations after source hardening.
      assert.equal(method.reviewedUncertified.coverageCredits, 0, label);
      assert.equal(method.reviewedUncertified.exactHeadPg16Http, "PENDING", label);
      assert.equal(method.reviewedUncertified.productionCertified, false, label);
      assert.equal(review.fullMethodCoverageCredits, 0, label);
    } else {
      for (const [kind, n] of Object.entries(review.sourceAnchors)) {
        assert.ok(Number.isSafeInteger(n) && n > 0 && n <= lines.length, label + " " + kind);
        assert.ok(lines[n - 1].trim().length > 0, label + " " + kind + " is blank");
      }
      const ownText = lines[own - 1], foreignText = lines[foreign - 1];
      const forgedText = lines[forged - 1], invariantText = lines[unchanged - 1];
      assert.match(ownText, /(?:context\.post\(|request\(|post\(|call\(|expectStatus\(await request\()/, label + " own request");
      assert.match(foreignText, /(?:context\.post\(|request\(|post\(|call\(|expectStatus\(await request\()/, label + " victim request");
      assert.match(forgedText, /(?:context\.post\(|request\(|post\(|call\(|expectStatus\(await request\()/, label + " forged request");
      assert.match(invariantText, /assert\.deepEqual\(/, label + " actual victim DB comparison");
    }
    if (pr !== 1501 && pr !== 1676 && pr !== 1662) {
      assert.equal(blobSha(review.proofFile), proofSha, label + " proof changed since exact final head");
    } else if (pr === 1501) {
      // Historical #1501 was rejection-only. A new synthetic ACCEPTED-branch
      // HTTP/PG16 candidate is in the current family row; no successful job
      // or accepted coverage credit is implied until its exact-head run.
      assert.equal(blobSha(review.proofFile), "d199e61b461827e8c4bdc2771dabf0a9102dcc5e",
        "new fictional accepted-path family proof changed; rerun exact-head CI");
      assert.notEqual(blobSha(review.proofFile),
        method.reviewedUncertified.proofBlobSha,
        "new accepted-path source cannot masquerade as merged #1501 evidence");
      const current = readFileSync(review.proofFile, "utf8");
      for (const token of [
        'for (let pad = 0; pad < 6; pad++)',
        'Number.isSafeInteger(filing.id) && filing.id > 6',
        'const [acceptFixture] = await db.insert(governmentFilingValidations).values({',
        'const acceptedHttp = expectStatus(await request(',
        'persistedAccepted.status, "accepted"',
        'acceptedAudit.action, "SSS R-3 filing accepted"',
        'acceptedOwnDecisionPG16: true',
        'acceptedForeignAndForgedDenied: true',
        'acceptedVictimDbAndAuditUnchanged: true',
        'proveFilingStateUntouched(victimBeforeAccepted,',
        'method: "PATCH", cookie, body: deniedCase.body',
      ]) assert.ok(current.includes(token),
        "current filing accepted branch lacks executable source control: " + token);
      assert.equal(method.reviewedUncertified.acceptedOutcomePositiveProven, false,
        "filing remains GAP until a fresh complete accepted HTTP/PG16 CI receipt passes");
      assert.equal(method.reviewedUncertified.fullMethodCoverageCredits, 0);
    }
    if (pr === 1676) {
      const handler = readFileSync(path, "utf8");
      for (const mode of ['"template"', '"check"', '"download"'])
        assert.ok(handler.includes(mode), "BIR POST action " + mode + " must be reviewed individually");
      assert.ok(review.missingParts.join(" ").includes("mode=check") &&
        review.missingParts.join(" ").includes("mode=download"),
        "Template-only BIR evidence must not silently certify check/download");
    }
    if ([1675,1674].includes(pr)) {
      assert.ok(!/>\s*6\b/.test(lines[ordering - 1]),
        label + ": the final-head ordering assertion itself does not prove the >6 floor");
    }
    const invRow = inventory.split("\n").find(line => line.includes("[\x60" + route + "\x60 " + verb + "]("));
    assert.ok(invRow?.includes("**GAP**") && invRow.includes("tenant-six-method-proof-review-2026-11-02.md"),
      label + " overview must cite review-only evidence without a credit");
    assert.ok(plan.includes("\x60" + verb + " " + route + "\x60"), label + " closure plan must list this hold");
  }
  const cited = allMethods.filter(({ method }) => method.reviewedUncertified?.reconciliationReview);
  assert.deepEqual(cited.map(({ path, method }) => method.name + " " + path.slice("src/app/api/".length, -"/route.ts".length)).sort(),
    cases.filter(c => !skipOpenCredit.has(c[0] + " " + c[1])).map(c => c[0] + " " + c[1]).sort(), "no unreviewed method or open-PR credit may borrow this hold");
});

test("six-method review permits only 3 #1728 compliance and 4 #1730 year-end credits", () => {
  const counts = { COVERED: 0, "PUBLIC-BY-DESIGN": 0, GAP: 0 };
  for (const { method } of allMethods) {
    assert.ok(Object.hasOwn(counts, method.status));
    counts[method.status]++;
  }
  assert.equal(allMethods.length, 498);

  // GitHub Actions shallow PR checkouts do not necessarily have origin/main.
  // Pin *every* main method status and the frozen subtotal to the reviewed
  // exact-base snapshot. This is a strict fallback, not an acceptance waiver.
  const fixtureFile = "tests/fixtures/tenant-six-method-main-ledger-20261103.json";
  const snapshot = JSON.parse(readFileSync(fixtureFile, "utf8"));
  assert.equal(blobSha(fixtureFile), "52f8a171b5f76b70571326c5dbe9307642d7bb8a",
    "Main ledger fixture changed; renew source-level security review");
  assert.equal(snapshot.schema, "payrollph-six-method-main-ledger-snapshot-v1");
  assert.equal(snapshot.sourceCommit, "78a8a69b3c924200ad9e522ff7e716c376a7ce20");
  assert.equal(snapshot.sourceManifestGitBlobSha, "656b0f190924e40c337e8b6291c14a0776b6f746");
  assert.equal(snapshot.sourceClosurePlanGitBlobSha, "86a92231daafa1accc8c0a263d30c6112c8ba8ba");
  assert.equal(Object.keys(snapshot.methodStatuses).length, 295);
  const methodStatuses = manifest => Object.fromEntries(
    Object.entries(manifest.allApiRouteFiles).map(([path, data]) => [
      path, Object.fromEntries(data.methods.map(row => [row.name, row.status])),
    ]),
  );
  // The six-method review itself grants ZERO credits. A separate and already
  // source-pinned #1728 proposal adds exactly three disjoint STA-01 POSTs.
  // Keep the reviewed 498-method baseline immutable, then apply ONLY those
  // three explicitly named, proven, non-production changes for this PR.
  const compliancePostCredits = [
    ["src/app/api/compliance/contribution-issues/route.ts",
      "scripts/qa/tenant-table-rows/write/compliance-contribution-post.mjs",
      "dfcf1615be01bb151e13a5d74c080299575ce53a"],
    ["src/app/api/compliance/payroll-month-close/route.ts",
      "scripts/qa/tenant-table-rows/write/compliance-payroll-month-close-post.mjs",
      "21daf9c24d55f4fb01ce84c6f5aef822ce0f3193"],
    ["src/app/api/compliance/statutory-remittances/route.ts",
      "scripts/qa/tenant-table-rows/write/compliance-statutory-remittances-post.mjs",
      "f24a7349c902dae0bc41a3989c8a88df24aedb6f"],
  ];
  const expectedStatuses = JSON.parse(JSON.stringify(snapshot.methodStatuses));
  for (const [path, sourceRowFile, sourceRowSha] of compliancePostCredits) {
    assert.equal(expectedStatuses[path]?.POST, "GAP", path + ": source baseline must be GAP");
    const route = m.allApiRouteFiles[path];
    const method = route?.methods.find(row => row.name === "POST");
    assert.equal(method?.status, "COVERED", path + ": #1728 POST status");
    const proof = method.testedBy;
    assert.ok(proof, path + ": a provisional credit requires source-pinned evidence");
    assert.equal(proof.prNumber, 1728, path + ": unique PR owner");
    assert.equal(proof.verifiedPrHeadSha, "d3cdcf020a559ae85c813d656620832dd0a46d4e");
    assert.equal(proof.workflowRunId, 41446327305);
    assert.equal(proof.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(proof.postgresMajor, 16);
    assert.equal(proof.independentlyAccepted, false);
    assert.equal(proof.productionCertified, false);
    assert.equal(proof.productionTested, false);
    assert.equal(proof.sourceRowFile, sourceRowFile);
    assert.equal(proof.sourceRowBlobSha, sourceRowSha);
    assert.equal(blobSha(sourceRowFile), sourceRowSha,
      path + ": fictional PG16 proof row modified without review");
    assert.equal(proof.routeBlobSha, route.gitBlobSha);
    assert.equal(blobSha(path), route.gitBlobSha,
      path + ": handler changed since source review");
    assert.equal(proof.proofBlobSha, blobSha("scripts/qa/tenant-write-table-http.mjs"));
    assert.equal(proof.workflowBlobSha,
      blobSha(".github/workflows/tenant-compliance-post-candidate.yml"));
    expectedStatuses[path].POST = "COVERED";
  }
  const expectedMainStatuses = JSON.parse(JSON.stringify(expectedStatuses));
  const issuedPromotions = [
    {
      path: "src/app/api/workforce/demand-observations/issued/route.ts",
      verb: "POST",
      routeSha: "549156b2e143c71bd33385fb1cc49a95cb120dfc",
      proofFile: "scripts/qa/tenant-issued-demand-http.mjs",
      proofSha: "a63e9aa94b9c85000433e9a40c778af449888757",
      workflowFile: ".github/workflows/tenant-issued-demand-http.yml",
      workflowSha: "caf01bd8e2c17e8cd5bfd17528cd56d7503aa312",
      proofHead: "1834b73aab8e162e19b4b260e51b32e6fa1fbbec",
      workflowRunId: 41444835667,
    },
    {
      path: "src/app/api/workforce/demand-observations/issued/score/route.ts",
      verb: "POST",
      routeSha: "5658c67c7758e78c68738f0e848edfcfc8bd17c3",
      proofFile: "scripts/qa/tenant-issued-demand-http.mjs",
      proofSha: "a63e9aa94b9c85000433e9a40c778af449888757",
      workflowFile: ".github/workflows/tenant-issued-demand-http.yml",
      workflowSha: "caf01bd8e2c17e8cd5bfd17528cd56d7503aa312",
      proofHead: "1834b73aab8e162e19b4b260e51b32e6fa1fbbec",
      workflowRunId: 41444835667,
    },
  ];
  for (const pin of issuedPromotions) {
    const label = pin.verb + " " + pin.path;
    assert.equal(expectedStatuses[pin.path]?.[pin.verb], "GAP", label + " must start GAP on main");
    const row = m.allApiRouteFiles[pin.path]?.methods.find(method => method.name === pin.verb);
    assert.equal(row?.status, "COVERED", label + " is the only permitted credit");
    const receipt = row.testedBy;
    assert.equal(receipt?.prNumber, 1731, label + " proof must belong to this PR");
    assert.equal(receipt?.proofHeadCommit, pin.proofHead, label + " executed proof head");
    assert.equal(receipt?.workflowRunId, pin.workflowRunId, label + " executed workflow");
    assert.ok(receipt?.evidence?.includes("/actions/runs/" + pin.workflowRunId + "/job/"),
      label + " must cite the executed proof job");
    assert.equal(receipt?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(receipt?.ownerIsOnlyReviewer, true);
    assert.equal(receipt?.independentlyAccepted, false);
    assert.equal(receipt?.productionCertified, false);
    assert.equal(receipt?.postgresMajor, 16);
    for (const [field, file, expectedSha] of [
      ["routeBlobSha", pin.path, pin.routeSha],
      ["proofBlobSha", pin.proofFile, pin.proofSha],
      ["workflowBlobSha", pin.workflowFile, pin.workflowSha],
    ]) {
      assert.equal(receipt?.[field], expectedSha, label + " immutable " + field);
      assert.equal(blobSha(file), expectedSha, label + " actual file hash " + file);
    }
    assert.equal(receipt?.file, pin.proofFile);
    assert.equal(receipt?.workflowFile, pin.workflowFile);
    expectedStatuses[pin.path][pin.verb] = "COVERED";
  }
  assert.equal(blobSha("scripts/qa/tenant-issued-demand-contract.mjs"),
    "a4a7714a42ada86a55192b160e3f5f2761af0500",
    "The original contract must remain byte-identical to the passed source proof");
  assert.equal(blobSha("tests/tenant-issued-demand-contract.test.mjs"),
    "0df0028ceda0413256575f3847c950194f6e73f3",
    "The original contract tests must remain byte-identical to the passed source proof");
  for (const pin of issuedPromotions) expectedMainStatuses[pin.path][pin.verb] = "COVERED";

  const permittedPromotions = [
    {
      path: "src/app/api/year-end/route.ts",
      verb: "GET",
      routeSha: "7572c6111cf40d398b3cc8c1f940efd0a9b8d362",
      proofFile: "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs",
      proofSha: "9e64fc18a1a5b76c3ec583a0668ea680efd1ed19",
      workflowFile: ".github/workflows/tenant-year-end-post-candidate.yml",
      workflowSha: "9e6ca6431b168e05afecc5e40a42b1973ad1f675",
      proofHead: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394887,
      actions: ["json", "preflight", "2316", "2316-print", "alphalist"],
    },
    {
      path: "src/app/api/year-end/route.ts",
      verb: "POST",
      routeSha: "7572c6111cf40d398b3cc8c1f940efd0a9b8d362",
      proofFile: "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs",
      proofSha: "9e64fc18a1a5b76c3ec583a0668ea680efd1ed19",
      workflowFile: ".github/workflows/tenant-year-end-post-candidate.yml",
      workflowSha: "9e6ca6431b168e05afecc5e40a42b1973ad1f675",
      proofHead: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394887,
      actions: ["annualization", "bind-run"],
    },
    {
      path: "src/app/api/year-end/prior-evidence/route.ts",
      verb: "GET",
      routeSha: "d2fc2fa7c4257d7e33545c8a23ea310abae7077d",
      proofFile: "scripts/qa/tenant-sta01-prior-evidence-http.mjs",
      proofSha: "350d22bee1fdbd726b85a32967d510994f6bfe00",
      workflowFile: ".github/workflows/tenant-sta01-prior-evidence-http.yml",
      workflowSha: "91bc91ceb677ac7ebf52c8edf78bcd2e43f3528d",
      proofHead: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394999,
      actions: ["read-decrypted"],
    },
    {
      path: "src/app/api/year-end/prior-evidence/route.ts",
      verb: "POST",
      routeSha: "d2fc2fa7c4257d7e33545c8a23ea310abae7077d",
      proofFile: "scripts/qa/tenant-sta01-prior-evidence-http.mjs",
      proofSha: "350d22bee1fdbd726b85a32967d510994f6bfe00",
      workflowFile: ".github/workflows/tenant-sta01-prior-evidence-http.yml",
      workflowSha: "91bc91ceb677ac7ebf52c8edf78bcd2e43f3528d",
      proofHead: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394999,
      actions: ["save", "approve"],
    },
  ];
  const creditedYearEndPromotions = permittedPromotions.filter(pin =>
    pin.path !== "src/app/api/year-end/route.ts");
  for (const pin of permittedPromotions) {
    const label = pin.verb + " " + pin.path;
    if (pin.path === "src/app/api/year-end/route.ts") {
      const held = m.allApiRouteFiles[pin.path]?.methods.find(method => method.name === pin.verb);
      assert.equal(expectedStatuses[pin.path]?.[pin.verb], "GAP", label + " historical status");
      assert.equal(held?.status, "GAP", label + " requires exact new-source proof");
      assert.equal(held?.testedBy, null);
      assert.equal(held?.reviewedUncertified?.kind, "year-end-binding-atomic-source-only-zero-credit");
      assert.equal(held?.reviewedUncertified?.routeBlobSha, "e4741d98c23e068f4ecd7032e172ce60b95852cf");
      assert.equal(blobSha(pin.path), "e4741d98c23e068f4ecd7032e172ce60b95852cf");
      continue;
    }
    assert.equal(expectedStatuses[pin.path]?.[pin.verb], "GAP", label + " must start GAP on main");
    const row = m.allApiRouteFiles[pin.path]?.methods.find(method => method.name === pin.verb);
    assert.equal(row?.status, "COVERED", label + " is the only permitted credit");
    const receipt = row.testedBy;
    assert.equal(receipt?.prNumber, 1730, label + " proof must belong to this PR");
    assert.equal(receipt?.verifiedPrHeadSha, pin.proofHead, label + " executed proof head");
    assert.equal(receipt?.workflowRunId, pin.workflowRunId, label + " executed workflow");
    assert.ok(receipt?.evidence?.includes("/actions/runs/" + pin.workflowRunId),
      label + " must cite the executed proof run");
    assert.equal(receipt?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(receipt?.ownerIsOnlyReviewer, true);
    assert.equal(receipt?.independentlyAccepted, false);
    assert.equal(receipt?.productionCertified, false);
    assert.equal(receipt?.productionTested, false);
    assert.equal(receipt?.postgresMajor, 16);
    assert.deepEqual(receipt?.methodActions, pin.actions, label + " exact actions proven");
    for (const [field, file, expectedSha] of [
      ["routeBlobSha", pin.path, pin.routeSha],
      ["proofBlobSha", pin.proofFile, pin.proofSha],
      ["workflowBlobSha", pin.workflowFile, pin.workflowSha],
    ]) {
      assert.equal(receipt?.[field], expectedSha, label + " immutable " + field);
      assert.equal(blobSha(file), expectedSha, label + " actual file hash " + file);
    }
    assert.equal(receipt?.file, pin.proofFile);
    assert.equal(receipt?.workflowFile, pin.workflowFile);
    expectedStatuses[pin.path][pin.verb] = "COVERED";
  }
  const expectedBeforePayout = JSON.parse(JSON.stringify(expectedStatuses));
  const payoutCredits = verifyPayoutProfileCredit(m);
  assert.equal(expectedStatuses["src/app/api/payout-profiles/route.ts"].PATCH, "GAP");
  expectedStatuses["src/app/api/payout-profiles/route.ts"].PATCH = "COVERED";
  const expectedAfterPayout = JSON.parse(JSON.stringify(expectedStatuses));

  // Three unrelated methods have now passed on their own exact-final-head
  // fictional-PG16/real-HTTP receipts. Run the strict byte/anchor/CI-receipt
  // verifier before allowing ONLY these three distinct new promotions.
  const recovery = verifyFiveMethodCredits(m);
  assert.equal(recovery.methodsCredited, 3);
  assert.equal(recovery.methodsHeld, 2);
  for (const evidence of EVIDENCE) {
    const path = "src/app/api/" + evidence.route + "/route.ts";
    assert.equal(expectedStatuses[path]?.[evidence.method], "GAP",
      path + ": only a previously GAP method may receive new proof credit");
    const method = m.allApiRouteFiles[path].methods.find(row => row.name === evidence.method);
    assert.equal(method.testedBy.workflowRunId, evidence.run);
    assert.equal(method.testedBy.routeBlobSha, evidence.routeSha);
    assert.equal(method.testedBy.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(method.testedBy.independentlyAccepted, false);
    expectedStatuses[path][evidence.method] = "COVERED";
  }
  // One provider-callback credit after the reviewed snapshot: webhooks/resend POST (merged proof #1763). Its pins are verified
  // by the dedicated inventory test; here only the exact method and receipt identity may move from GAP.
  const resendPath = "src/app/api/webhooks/resend/route.ts";
  assert.equal(expectedStatuses[resendPath]?.POST, "GAP", "Resend POST must start GAP in the reviewed snapshot");
  const resendMethod = m.allApiRouteFiles[resendPath].methods.find(row => row.name === "POST");
  assert.equal(resendMethod?.status, "COVERED");
  assert.equal(resendMethod.testedBy?.file, "scripts/qa/tenant-webhook-resend-http.mjs");
  assert.equal(resendMethod.testedBy.proofPullRequest, 1763);
  assert.equal(resendMethod.testedBy.independentSecurityReview, "PENDING");
  assert.equal(resendMethod.testedBy.productionTested, false);
  expectedStatuses[resendPath].POST = "COVERED";
  const resendCredits = 1;
  // Second provider-callback credit after the snapshot: webhooks/xendit/subscriptions POST (merged proof refresh #1777), counted under the
  // bounded documentedRetryRefusal exception. Only the exact method and receipt identity may move from GAP.
  const subscriptionsPath = "src/app/api/webhooks/xendit/subscriptions/route.ts";
  assert.equal(expectedStatuses[subscriptionsPath]?.POST, "GAP", "Xendit subscriptions POST must start GAP in the reviewed snapshot");
  const subscriptionsMethod = m.allApiRouteFiles[subscriptionsPath].methods.find(row => row.name === "POST");
  assert.equal(subscriptionsMethod?.status, "COVERED");
  assert.equal(subscriptionsMethod.testedBy?.file, "scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs");
  assert.equal(subscriptionsMethod.testedBy.proofPullRequest, 1777);
  assert.equal(subscriptionsMethod.testedBy.ruleException, "proofPolicy.providerCallback.documentedRetryRefusal");
  assert.equal(subscriptionsMethod.testedBy.independentSecurityReview, "PENDING");
  assert.equal(subscriptionsMethod.testedBy.productionTested, false);
  expectedStatuses[subscriptionsPath].POST = "COVERED";
  const subscriptionsCredits = 1;
  // #1766 contributes one disjoint, provisional PII-02 MWE decision PATCH.
  // Require its exact method-specific source record; no independent signoff.
  const mweDecisionPath = "src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts";
  assert.equal(expectedStatuses[mweDecisionPath]?.PATCH, "GAP");
  const mweDecision = m.allApiRouteFiles[mweDecisionPath].methods.find(row => row.name === "PATCH");
  assert.equal(mweDecision?.status, "COVERED");
  assert.equal(mweDecision?.testedBy?.file, "scripts/qa/tenant-mwe-decision-http.mjs");
  assert.equal(mweDecision?.testedBy?.routeBlobSha, m.allApiRouteFiles[mweDecisionPath].gitBlobSha);
  assert.equal(mweDecision?.testedBy?.workflowBlobSha, "584d159f2d2c250e182d0942188f293baebc2141");
  assert.equal(mweDecision?.testedBy?.independentlyAccepted, false);
  assert.equal(mweDecision?.testedBy?.productionCertified, false);
  expectedStatuses[mweDecisionPath].PATCH = "COVERED";
  // Preserve #1764's one static-public catalog exception, without tenant credit.
  const publicCatalogPath = "src/app/api/v1/route.ts";
  assert.equal(expectedStatuses[publicCatalogPath]?.GET, "GAP");
  const publicCatalog = m.allApiRouteFiles[publicCatalogPath]?.methods.find(row => row.name === "GET");
  assert.equal(publicCatalog?.status, "PUBLIC-BY-DESIGN");
  assert.equal(publicCatalog?.testedBy, null);
  expectedStatuses[publicCatalogPath].GET = "PUBLIC-BY-DESIGN";
  assert.deepEqual(methodStatuses(m), expectedStatuses,
    "Preserves payout PATCH and revoked year-end pair while permitting exactly three source-verified additional credits");
  const expectedCounts = {
    COVERED: snapshot.counts.COVERED + compliancePostCredits.length + creditedYearEndPromotions.length + issuedPromotions.length + payoutCredits + recovery.methodsCredited + resendCredits + subscriptionsCredits + 1,
    "PUBLIC-BY-DESIGN": snapshot.counts["PUBLIC-BY-DESIGN"] + 1,
    GAP: snapshot.counts.GAP - compliancePostCredits.length - creditedYearEndPromotions.length - issuedPromotions.length - payoutCredits - recovery.methodsCredited - resendCredits - subscriptionsCredits - 2,
  };
  assert.deepEqual(counts, expectedCounts,
    "The source-revoked year-end pair remains GAP; three exact-head method receipts are added");
  assert.equal(m.metrics.methods, allMethods.length);
  assert.equal(m.metrics.coveredAfter, counts.COVERED);
  assert.equal(m.metrics.publicByDesign, counts["PUBLIC-BY-DESIGN"]);
  assert.equal(m.metrics.gap, counts.GAP);
  assert.equal(m.metrics.scopedPagesAndActions, 21);
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.ok(inventory.includes(String(counts.COVERED) + " COVERED"));
  assert.ok(plan.includes(
    "Frozen subtotal (2026-11-04 proposal): **327 COVERED + 3 PUBLIC-BY-DESIGN + 76 GAP = 406**"),
    "Current frozen subtotal includes three independently verified credits and retains invalidated year-end GAPs");
  assert.ok(plan.includes("ZERO CREDITS / NOT ACCEPTED"));

  // When a full checkout has origin/main, also verify that it agrees with the
  // exact-base fixture. A changed main requires a deliberate re-review/re-pin.
  let hasMainRef = false;
  try {
    execFileSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main"],
      { stdio: "ignore" });
    hasMainRef = true;
  } catch {
    // Missing remote ref is normal in CI with fetch-depth: 1.
  }
  if (hasMainRef) {
    const baseline = JSON.parse(execFileSync("git",
      ["show", "origin/main:scripts/qa/tenant-isolation-coverage-manifest.json"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
    const payoutMethod = baseline.allApiRouteFiles["src/app/api/payout-profiles/route.ts"]
      .methods.find(method => method.name === "PATCH");
    const baselineHasPayout = payoutMethod?.status === "COVERED";
    if (baselineHasPayout) verifyPayoutProfileCredit(baseline);
    const mainYearEnd = baseline.allApiRouteFiles["src/app/api/year-end/route.ts"];
    const baselineHasOldRoute = mainYearEnd.methods.every(method => method.status === "COVERED");
    if (baselineHasOldRoute) {
      assert.equal(mainYearEnd.gitBlobSha, "7572c6111cf40d398b3cc8c1f940efd0a9b8d362",
        "old-source year-end receipts must be pinned before supersession");
      for (const method of mainYearEnd.methods) {
        assert.equal(method.testedBy?.routeBlobSha, mainYearEnd.gitBlobSha);
        assert.equal(method.testedBy?.workflowRunId, 41446394887);
        assert.equal(method.testedBy?.independentlyAccepted, false);
      }
    } else {
      for (const method of mainYearEnd.methods) {
        assert.equal(method.status, "GAP");
        assert.equal(method.testedBy, null);
      }
    }
    // Main now contains the three individually source-pinned #1760 recoveries.
    // Either ALL three exact-method credits are present or none is. Never
    // infer coverage from a loose count or permit an unreviewed partial merge.
    const mainRecoveryCredits = EVIDENCE.map(e =>
      baseline.allApiRouteFiles["src/app/api/" + e.route + "/route.ts"]
        ?.methods.find(row => row.name === e.method)?.status === "COVERED");
    assert.ok(mainRecoveryCredits.every(credited => credited === mainRecoveryCredits[0]),
      "origin/main must not contain a partial five-method proof recovery");
    const baselineHasRecovery = mainRecoveryCredits[0];
    if (baselineHasRecovery) {
      const receipt = verifyFiveMethodCredits(baseline);
      assert.equal(receipt.methodsCredited, 3);
      assert.equal(receipt.methodsHeld, 2);
    }
    // Provider-callback credits merged to main after the reviewed snapshot. Each is accepted on main only when the
    // exact method carries its own receipt under proofPolicy.providerCallback with independent review still PENDING;
    // a credit that is absent from main is simply not expected, so this block never goes stale on merge order.
    const mainProviderCredits = [
      ["src/app/api/webhooks/resend/route.ts", "scripts/qa/tenant-webhook-resend-http.mjs"],
      ["src/app/api/webhooks/xendit/subscriptions/route.ts", "scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs"],
    ].filter(([path, receipt]) => {
      const row = baseline.allApiRouteFiles[path]?.methods.find(item => item.name === "POST");
      if (row?.status !== "COVERED") return false;
      assert.equal(row.testedBy?.file, receipt, path + ": main credit must carry its own receipt");
      assert.equal(row.testedBy.rule, "proofPolicy.providerCallback");
      assert.equal(row.testedBy.independentSecurityReview, "PENDING");
      if (path === resendPath) {
        assert.equal(row.testedBy.workflowRunId, 41829420219);
        assert.equal(row.testedBy.workflowJobId, 126572429402);
        assert.equal(row.testedBy.productionTested, false);
      }
      return true;
    });
    const expectedOriginalMain = JSON.parse(JSON.stringify(
      baselineHasPayout ? expectedAfterPayout : expectedBeforePayout));
    for (const [path] of mainProviderCredits) expectedOriginalMain[path].POST = "COVERED";
    if (baselineHasRecovery) {
      for (const e of EVIDENCE) {
        expectedOriginalMain["src/app/api/" + e.route + "/route.ts"][e.method] = "COVERED";
      }
    }
    assert.equal(baseline.allApiRouteFiles[publicCatalogPath].methods.find(row => row.name === "GET")?.status,
      "PUBLIC-BY-DESIGN", "Current main must retain #1764 public catalog evidence");
    expectedOriginalMain[publicCatalogPath].GET = "PUBLIC-BY-DESIGN";
    if (baselineHasOldRoute) {
      expectedOriginalMain["src/app/api/year-end/route.ts"].GET = "COVERED";
      expectedOriginalMain["src/app/api/year-end/route.ts"].POST = "COVERED";
    }
    assert.deepEqual(methodStatuses(baseline), expectedOriginalMain,
      "origin/main may include only source-pinned payout and three #1760 recovery credits, with unproved methods held");
    const expectedMainYearEndCredits = creditedYearEndPromotions.length +
      (baselineHasOldRoute ? 2 : 0);
    assert.deepEqual({
      COVERED: baseline.metrics.coveredAfter,
      "PUBLIC-BY-DESIGN": baseline.metrics.publicByDesign,
      GAP: baseline.metrics.gap,
    }, {
      COVERED: snapshot.counts.COVERED + compliancePostCredits.length +
        issuedPromotions.length + expectedMainYearEndCredits +
        (baselineHasPayout ? payoutCredits : 0) +
        (baselineHasRecovery ? EVIDENCE.length : 0) + mainProviderCredits.length,
      "PUBLIC-BY-DESIGN": snapshot.counts["PUBLIC-BY-DESIGN"] + 1,
      GAP: snapshot.counts.GAP - compliancePostCredits.length -
        issuedPromotions.length - expectedMainYearEndCredits -
        (baselineHasPayout ? payoutCredits : 0) -
        (baselineHasRecovery ? EVIDENCE.length : 0) - mainProviderCredits.length - 1,
    }, "origin/main has unexplained method count drift");
    const baselinePlan = execFileSync("git",
      ["show", "origin/main:docs/engineering/tenant-isolation-closure-plan.md"],
      { encoding: "utf8" });
    const frozenCovered = 320 + (baselineHasOldRoute ? 2 : 0) +
      (baselineHasPayout ? 1 : 0) + (baselineHasRecovery ? EVIDENCE.length : 0) + mainProviderCredits.length;
    const expectedMainFrozen = snapshot.frozenSubtotal
      .replace("313 COVERED", frozenCovered + " COVERED")
      .replace("2 PUBLIC-BY-DESIGN", "3 PUBLIC-BY-DESIGN")
      .replace("91 GAP", (403 - frozenCovered) + " GAP");
    // Current main dates the frozen subtotal; earlier snapshots used a plain label.
    // Normalize ONLY that heading, never the verified counts or credited methods.
    const mainFrozenSubtotal = baselinePlan.split("\n").find(line =>
      line.startsWith("Frozen subtotal: **") ||
      line.startsWith("Frozen subtotal (2026-11-04 proposal): **"));
    assert.equal(mainFrozenSubtotal?.replace(
      /^Frozen subtotal \(2026-11-04 proposal\):/, "Frozen subtotal:"),
      expectedMainFrozen, "origin/main frozen ledger drift");
  }
});
