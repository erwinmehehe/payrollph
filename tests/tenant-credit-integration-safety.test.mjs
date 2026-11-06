import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Merge-safety contract for tenant-isolation evidence on main.
 *
 * PR #1805 was prepared before main received #1807's payout-reconciliation
 * credit. When its independent receipt and workforce-planning proofs are
 * reconciled, we must retain the existing payout proof and not double-count
 * or silently classify previously unproven methods as COVERED.
 *
 * This test is source-only: no database, external services, payroll release,
 * live payment provider, coverage promotion, or production acceptance.
 */
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const PROPOSED_METHODS = [
  { path: "src/app/api/expenses/receipts/route.ts", verb: "GET", proofPr: 1772 },
  { path: "src/app/api/expenses/receipts/route.ts", verb: "POST", proofPr: 1772 },
  { path: "src/app/api/workforce-planning/route.ts", verb: "POST", proofPr: 1755 },
  { path: "src/app/api/workforce-planning/route.ts", verb: "PATCH", proofPr: 1755 },
];

function getMethod(data, path, verb) {
  const methods = data.allApiRouteFiles?.[path]?.methods;
  assert.ok(Array.isArray(methods), "missing inventoried route " + path);
  const matches = methods.filter((method) => method.name === verb);
  assert.equal(matches.length, 1, "expected exactly one " + verb + " method at " + path);
  return matches[0];
}

function checkLedger(data) {
  assert.match(data.acceptanceStatus, /^NOT ACCEPTED:/, "source-only coverage is not tenant-wide approval");
  const entries = Object.entries(data.allApiRouteFiles).flatMap(([path, row]) =>
    row.methods.map((method) => ({ path, method }))
  );
  const keys = entries.map(({ path, method }) => method.name + " " + path);
  assert.equal(new Set(keys).size, keys.length, "one ledger entry per route/method");
  const total = entries.length;
  const covered = entries.filter(({ method }) => method.status === "COVERED").length;
  const isPublic = entries.filter(({ method }) => method.status === "PUBLIC-BY-DESIGN").length;
  const gap = entries.filter(({ method }) => method.status === "GAP").length;
  assert.equal(total, covered + isPublic + gap, "unknown tenant coverage status");
  assert.equal(data.metrics.methods, total, "total API method inventory drift");
  assert.equal(data.metrics.coveredAfter, covered, "COVERED metric drift");
  assert.equal(data.metrics.publicByDesign, isPublic, "PUBLIC-BY-DESIGN metric drift");
  assert.equal(data.metrics.gap, gap, "GAP metric drift");
}

function checkExistingPayout(data) {
  const method = getMethod(
    data, "src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", "POST"
  );
  assert.equal(method.status, "COVERED", "merged #1807 payout credit must remain COVERED");
  const proof = method.testedBy;
  assert.ok(proof && typeof proof === "object", "payout credit requires its existing receipt");
  assert.equal(proof.providerMode, "loopback-synthetic-paymongo", "never claim live-provider proof");
  assert.deepEqual(proof.methodActions, ["reconcile", "retry-failed"], "both actions were evidenced");
  assert.equal(proof.moneyMovedByLinaw, false, "no real money movement was evidenced");
  assert.equal(proof.productionTested, false, "disposable proof is not a production test");
  assert.equal(proof.independentSecurityReview, "PENDING", "independent review is not yet accepted");
  assert.equal(proof.workflowRunId, 42229558806, "retain merged #1807 source receipt");
  assert.equal(proof.workflowJobId, 127931638957, "retain merged #1807 receipt job");
}

function checkFourPendingMethods(data) {
  for (const { path, verb, proofPr } of PROPOSED_METHODS) {
    const method = getMethod(data, path, verb);
    if (method.status === "GAP") {
      assert.equal(method.testedBy, null, verb + " " + path + " has no accepted method proof");
      continue;
    }
    assert.equal(method.status, "COVERED", verb + " " + path + " has an unexpected status");
    const proof = method.testedBy;
    assert.ok(proof && typeof proof === "object",
      verb + " " + path + " requires source-pinned proof before promotion");
    assert.equal(proof.proofPullRequest, proofPr,
      verb + " " + path + " must link its own independent historical proof PR");
    assert.ok(Number.isSafeInteger(proof.workflowRunId) && proof.workflowRunId > 0,
      "missing executed workflow run");
    assert.ok(Number.isSafeInteger(proof.workflowJobId) && proof.workflowJobId > 0,
      "missing executed workflow job");
    assert.equal(proof.independentSecurityReview, "PENDING",
      "provisional evidence must not claim independent security approval");
    assert.equal(proof.productionTested, false, "no live-system proof is claimed");
  }
}

function validate(data) {
  checkLedger(data);
  checkExistingPayout(data);
  checkFourPendingMethods(data);
}

test("main and future #1805 merge preserve tenant ledger integrity and distinct credits", () => {
  validate(manifest);
});

test("merge guard refuses accidental loss of the #1807 payout credit", () => {
  const altered = structuredClone(manifest);
  getMethod(altered, "src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", "POST").status = "GAP";
  assert.throws(() => validate(altered), /metric drift|payout credit must remain COVERED/);
});

test("merge guard refuses unproved promotion of an independent #1805 method", () => {
  const altered = structuredClone(manifest);
  getMethod(altered, PROPOSED_METHODS[0].path, "GET").status = "COVERED";
  // Even after recalculating totals, a missing proof cannot be accepted.
  altered.metrics.coveredAfter += 1;
  altered.metrics.gap -= 1;
  assert.throws(() => validate(altered), /requires source-pinned proof/);
});
