/**
 * Non-credentialled, source-only guard on six merged proof candidates.
 * Keeps historical coverage + live metrics unchanged until the exact four-part
 * contract is satisfied on a final-head, independent PG16 HTTP run.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("six exact method identities stay GAP, zero credits and source/head anchored", () => {
  assert.equal(cases.length, 6);
  for (const [verb, route, pr, head, proofSha, own, foreign, forged, unchanged, ordering, missing] of cases) {
    const path = "src/app/api/" + route + "/route.ts";
    const entry = m.allApiRouteFiles[path];
    assert.ok(entry, path);
    const method = entry.methods.find(row => row.name === verb);
    const label = verb + " " + route;
    assert.equal(method?.status, "GAP", label);
    assert.equal(method.testedBy, null, label + " must never borrow a partial receipt");
    if (skipOpenCredit.has(label)) {
      assert.equal(method.reason, "No valid own-object + real victim-only denial was linked to this method",
        label + ": concurrent open #1727 owns any proposed credit; keep main entry unchanged");
      assert.equal(method.reviewedUncertified, undefined, label + ": no overlapping metadata change");
      const skippedRow = inventory.split("\n").find(line => line.includes("[\x60" + route + "\x60 " + verb + "]("));
      assert.ok(skippedRow?.includes("NO VALID METHOD PROOF") && skippedRow.includes("**GAP**"),
        label + ": skipped inventory citation must be unchanged");
      continue;
    }
    assert.match(method.reason, /Still GAP:/, label);
    const review = method.reviewedUncertified?.reconciliationReview;
    assert.ok(review && typeof review === "object", label);
    assert.equal(review.proofPr, pr, label);
    assert.equal(review.proofFinalHead, head, label);
    assert.match(review.passedJob, /https:\/\/github\.com\/erwinmehehe\/payrollph\/actions\/runs\/\d+\/job\/\d+$/, label);
    assert.equal(review.proofBlobShaAtFinalHead, proofSha, label);
    assert.equal(review.reviewedRouteBlobSha, entry.gitBlobSha, label);
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
    if (pr !== 1501 && pr !== 1676) {
      assert.equal(blobSha(review.proofFile), proofSha, label + " proof changed since exact final head");
    } else if (pr === 1501) {
      // Historical #1501 was rejection-only. A new synthetic ACCEPTED-branch
      // HTTP/PG16 candidate is in the current family row; no successful job
      // or accepted coverage credit is implied until its exact-head run.
      assert.equal(blobSha(review.proofFile), "cb27590280c58a34615faef99cdc33bb02330e66",
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

test("live and frozen tenant ledgers remain exactly unchanged and unaccepted", () => {
  const counts = { COVERED:0, "PUBLIC-BY-DESIGN":0, GAP:0 };
  for (const { method } of allMethods) {
    assert.ok(Object.hasOwn(counts, method.status));
    counts[method.status]++;
  }
  assert.equal(allMethods.length, 498);
  assert.deepEqual(counts, { COVERED:386, "PUBLIC-BY-DESIGN":10, GAP:102 });
  assert.equal(m.metrics.methods, allMethods.length);
  assert.equal(m.metrics.coveredAfter, counts.COVERED);
  assert.equal(m.metrics.publicByDesign, counts["PUBLIC-BY-DESIGN"]);
  assert.equal(m.metrics.gap, counts.GAP);
  assert.equal(m.metrics.scopedPagesAndActions, 21);
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.ok(inventory.includes("386 COVERED + 10 PUBLIC-BY-DESIGN + 102 GAP"));
  assert.ok(plan.includes("Frozen subtotal: **302 COVERED + 2 PUBLIC-BY-DESIGN + 102 GAP = 406**"));
  assert.ok(plan.includes("ZERO CREDITS / NOT ACCEPTED"));
});
