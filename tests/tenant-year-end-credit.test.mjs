import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test"; import { verifyWorker360PageCredit } from "../scripts/qa/tenant-five-method-credit-verify.mjs";
import {
  YEAR_END_RECEIPTS, verifyYearEndCredits,
} from "../scripts/qa/tenant-year-end-credit.mjs";

const getManifest = () => JSON.parse(
  readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const row = (m, verb) => m.allApiRouteFiles[
  "src/app/api/year-end/route.ts"].methods.find(v => v.name === verb);

test("merged #1804 PG16 source proof gives only year-end GET and POST credits", () => {
  const m = getManifest();
  assert.equal(verifyYearEndCredits(m), 2);
  assert.deepEqual(YEAR_END_RECEIPTS.map(x => x.method), ["GET", "POST"]);
  for (const verb of ["GET", "POST"]) {
    const method = row(m, verb);
    assert.equal(method.status, "COVERED");
    assert.equal(method.testedBy.proofPullRequest, 1804);
    assert.equal(method.testedBy.workflowRunId, 42254117862);
    assert.equal(method.testedBy.ownerIsOnlyReviewer, true);
    assert.equal(method.testedBy.independentlyAccepted, false);
  }
  assert.equal(m.metrics.privilegedOperationsTokenOnly, 11, "exactly eleven approved operations remain token-only, not method credits");
  assert.equal(m.metrics.coveredAfter + m.metrics.publicByDesign + m.metrics.privilegedOperationsTokenOnly + m.metrics.gap, m.metrics.methods);
  assert.ok(m.acceptanceStatus.startsWith("NOT ACCEPTED: " + m.metrics.gap + " API methods and " + verifyWorker360PageCredit(m) + " page/action GAPs"));
});

test("forged receipt, altered financial source, and fake approval fail closed", () => {
  const m = getManifest();
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
  assert.equal(verifyYearEndCredits(m), 2);
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
    assert.equal(row(m, verb).testedBy.governmentFilingPerformed, false);
    assert.equal(row(m, verb).testedBy.productionMoneyMoved, false);
  }
});
