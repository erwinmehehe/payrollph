import { verifyCurrentScopedPageGapCount } from "../scripts/qa/tenant-five-scoped-page-credit.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test"; import { verifyWorker360PageCredit } from "../scripts/qa/tenant-five-method-credit-verify.mjs";
import {
  YEAR_END_RECEIPTS, isYearEndHeld, isWageYearEndHeld, verifyWageYearEndHold,
  verifyYearEndCredits, verifyYearEndHold, verifyYearEndPairState,
} from "../scripts/qa/tenant-year-end-credit.mjs";

const getManifest = () => JSON.parse(
  readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const row = (m, verb) => m.allApiRouteFiles[
  "src/app/api/year-end/route.ts"].methods.find(v => v.name === verb);

test("merged #1804 PG16 source proof gives only year-end GET and POST credits", () => {
  const m = getManifest();
  assert.equal(verifyYearEndPairState(m), (isYearEndHeld(m)||isWageYearEndHeld(m)) ? 0 : 2);
  assert.deepEqual(YEAR_END_RECEIPTS.map(x => x.method), ["GET", "POST"]);
  for (const verb of ["GET", "POST"]) {
    const method = row(m, verb);
    if (isYearEndHeld(m)||isWageYearEndHeld(m)) {
      assert.equal(method.status,"GAP");assert.equal(method.testedBy,null);continue;
    }
    assert.equal(method.status, "COVERED");
    assert.equal(method.testedBy.proofPullRequest, 1804);
    assert.equal(method.testedBy.workflowRunId, 43372002300);
    assert.equal(method.testedBy.ownerIsOnlyReviewer, true);
    assert.equal(method.testedBy.independentlyAccepted, false);
  }
  const workerRoute=m.allApiRouteFiles["src/app/api/hcm/work-items/escalate/route.ts"];
  const worker=workerRoute.methods.find(x=>x.name==="POST");
  const classified=worker.status==="PRIVILEGED-OPERATIONS-TOKEN-ONLY";
  if (classified) {
    assert.equal(worker.privilegedOperation?.routeBlobSha,workerRoute.gitBlobSha);
    assert.equal(worker.privilegedOperation?.methodCoverageCredits,0);
    assert.equal(worker.testedBy,null);
  }
  assert.equal(m.metrics.privilegedOperationsTokenOnly,11+Number(classified),
    "Only 11 historical operations plus the zero-credit HCM scheduler");
  assert.equal(m.metrics.coveredAfter + m.metrics.publicByDesign + m.metrics.privilegedOperationsTokenOnly + m.metrics.gap, m.metrics.methods);
  assert.ok(m.acceptanceStatus.startsWith("NOT ACCEPTED: " + m.metrics.gap + " API methods and " + verifyCurrentScopedPageGapCount(m) + " page/action GAPs"));
});

test("forged receipt, altered financial source, and fake approval fail closed", () => {
  const m = getManifest();
  if (isWageYearEndHeld(m)) {
    assert.equal(verifyWageYearEndHold(m),0);
    for(const change of [
      candidate=>{row(candidate,"GET").status="COVERED";},
      candidate=>{row(candidate,"POST").reviewedUncertified.coverageCredits=1;},
      candidate=>{row(candidate,"GET").testedBy={file:"fake.mjs"};},
      candidate=>{row(candidate,"POST").reviewedUncertified.productionCertified=true;},
    ]){
      const fake=structuredClone(m);change(fake);
      assert.throws(()=>verifyWageYearEndHold(fake),"Tampered wage-source hold cannot restore credit");
    }
    // An edited payroll engine is rejected at the historical source-blob pin
    // before the verifier reaches the older held-method check. Both outcomes
    // fail closed; neither grants coverage to the 47 zero-credit wage holds.
    assert.throws(() => verifyYearEndCredits(m),
      /(?:current-source proof required|source\/proof changed; renew PG16 review)/,
      "Stale #1804 source receipt must not restore year-end GET/POST coverage");
    return;
  }
  if (isYearEndHeld(m)) {
    // The credited-state tamper matrix reactivates when a fresh proof renews the credit. While held, the withdrawal
    // itself must reject re-promotion without a receipt, and the moved source must not verify as a credit.
    const promoted = structuredClone(m);
    row(promoted, "GET").status = "COVERED";
    assert.throws(() => verifyYearEndHold(promoted));
    assert.throws(() => verifyYearEndCredits(m), /source\/proof changed/, "the withdrawn credit must not verify against the moved source");
    return;
  }
  const changes = [
    a => { row(a, "GET").status = "GAP"; },
    a => { row(a, "POST").testedBy.workflowRunId++; },
    a => { row(a, "GET").testedBy.proofBlobSha = "0".repeat(40); },
    a => { row(a, "POST").testedBy.unchangedDbLine++; },
    a => { row(a, "GET").testedBy.independentPayrollReview = "APPROVED"; },
    a => { row(a, "POST").testedBy.productionCertified = true; },
    a => { row(a, "GET").testedBy.methodActions = ["unproven"]; },
    a => { a.metrics.methods++; },
  ];
  for (const change of changes) {
    const candidate = structuredClone(m);
    change(candidate);
    assert.throws(() => verifyYearEndCredits(candidate));
  }
  assert.throws(() => verifyYearEndCredits(m, path =>
    path === "src/app/api/year-end/route.ts"
      ? Buffer.concat([readFileSync(path), Buffer.from("\n// unverified drift\n")])
      : readFileSync(path)), /source\/proof changed/);
});

test("year-end evidence is internal only; billing is not claimed here", () => {
  const m = getManifest();
  assert.equal(verifyYearEndPairState(m), (isYearEndHeld(m)||isWageYearEndHeld(m)) ? 0 : 2);
  for (const name of ["start", "cancel"]) {
    const method = m.allApiRouteFiles[
      "src/app/api/billing/subscription/" + name + "/route.ts"].methods.find(x => x.name === "POST");
    assert.ok(["GAP", "COVERED"].includes(method.status),
      "Only the separate #1826 billing reconciliation can alter this method");
    if (method.status === "GAP") {
      assert.equal(method.testedBy, null);
    } else {
      assert.equal(method.testedBy?.proofPullRequest, 1804);
      assert.equal(method.testedBy?.workflowRunId, 42254118161);
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-billing-subscription-http.mjs");
    }
  }
  const source = readFileSync(
    "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs", "utf8");
  assert.match(source, /noOfficialFilingOrPayment: true/);
  assert.match(source, /independentReviewPending: true/);
  for (const verb of ["GET", "POST"]) {
    if (isYearEndHeld(m)||isWageYearEndHeld(m)) {
      assert.equal(row(m,verb).reviewedUncertified.productionCertified,false);continue;
    }
    assert.equal(row(m, verb).testedBy.governmentFilingPerformed, false);
    assert.equal(row(m, verb).testedBy.productionMoneyMoved, false);
  }
});
