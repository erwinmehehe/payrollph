import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BILLING_CREDIT_RECEIPT,
  BILLING_METHODS,
  verifyBillingSubscriptionCredits,
} from "../scripts/qa/tenant-billing-subscription-credit.mjs";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const record = (m, path) => m.allApiRouteFiles[path].methods.find(x => x.name === "POST");

test("merged fictional PG16 receipt supports only two billing POST method credits", () => {
  assert.equal(verifyBillingSubscriptionCredits(manifest), 2);
  assert.equal(BILLING_CREDIT_RECEIPT.run, 42254118161);
  assert.equal(BILLING_CREDIT_RECEIPT.job, 128016607991);
  for (const m of BILLING_METHODS) {
    assert.equal(record(manifest, m.path).status, "COVERED");
    assert.equal(record(manifest, m.path).testedBy.productionTested, false);
    assert.equal(record(manifest, m.path).testedBy.independentSecurityReview, "PENDING");
  }
  const readRoute = manifest.allApiRouteFiles["src/app/api/billing/subscription/route.ts"];
  assert.notEqual(readRoute?.methods.find(x => x.name === "GET")?.testedBy?.proofPullRequest,
    1804, "GET billing/subscription must not borrow POST proof");
});

test("a forged extra credit, job, method, or source change fails closed", () => {
  const first = BILLING_METHODS[0].path, second = BILLING_METHODS[1].path;
  for (const mutate of [
    m => { record(m, first).status = "GAP"; },
    m => { record(m, second).testedBy.workflowRunId++; },
    m => { record(m, first).testedBy.workflowJobId++; },
    m => { record(m, second).testedBy.methodEvidence.realForeignCancellation403 = 0; },
    m => { record(m, first).testedBy.independentSecurityReview = "APPROVED"; },
    m => { m.metrics.coveredAfter++; },
  ]) {
    const m = structuredClone(manifest);
    mutate(m);
    assert.throws(() => verifyBillingSubscriptionCredits(m));
  }
  assert.throws(() => verifyBillingSubscriptionCredits(manifest, path => {
    const source = readFileSync(path);
    return path === first ? Buffer.concat([source, Buffer.from("\n// unproven drift\n")]) : source;
  }), /Source\/proof input drift/);
});

test("method credit cannot grant tenant-wide, money, or production approval", () => {
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.equal(manifest.metrics.publicByDesign, 11);
  assert.equal(manifest.metrics.scopedPagesAndActions, 21);
  for (const m of BILLING_METHODS) {
    const receipt = record(manifest, m.path).testedBy;
    assert.equal(receipt.providerActual, false);
    assert.match(receipt.scope, /fictional|synthetic/i);
  }
});
