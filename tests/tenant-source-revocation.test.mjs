import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { isYearEndHeld, verifyYearEndCredits, verifyYearEndHold } from "../scripts/qa/tenant-year-end-credit.mjs";

const live = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const yearEndRoute = "src/app/api/year-end/route.ts";

test("old #1730 year-end proof stays source-revoked; #1804 adds two new provisional source-pinned receipts", () => {
  if (isYearEndHeld(live)) {
    assert.equal(verifyYearEndHold(live), 0);
    assert.deepEqual(live.allApiRouteFiles[yearEndRoute].methods.map(method => [method.name, method.status, method.testedBy]),
      [["GET", "GAP", null], ["POST", "GAP", null]]);
  } else {
    assert.equal(verifyYearEndCredits(live), 2);
    assert.deepEqual(live.allApiRouteFiles[yearEndRoute].methods.map(method => [
      method.name, method.status, method.testedBy?.proofPullRequest,
      method.testedBy?.independentlyAccepted,
    ]), [["GET", "COVERED", 1804, false], ["POST", "COVERED", 1804, false]]);
  }
  assert.equal(live.allApiRouteFiles[yearEndRoute].gitBlobSha,
    "f040f5bbbc3df275d32d23f1728b1b0345f77814");
  assertLiveTenantCounts(assert, live);
  assert.equal(live.allApiRouteFiles["src/app/api/payout-profiles/route.ts"].methods
    .find(method => method.name === "PATCH").status, "COVERED");
});

test("current year-end proof refuses changed source, evidence, approval claims and partial credit", () => {
  if (isYearEndHeld(live)) {
    // Withdrawn state: the hold itself must be exact and fail closed against every tamper.
    const tampers = [
      doc => { doc.allApiRouteFiles[yearEndRoute].methods[0].status = "COVERED"; },
      doc => { doc.allApiRouteFiles[yearEndRoute].methods[1].reviewedUncertified.credits = 1; },
      doc => { doc.allApiRouteFiles[yearEndRoute].methods[0].reviewedUncertified.annualizationBlobSha = "0".repeat(40); },
      doc => { doc.allApiRouteFiles[yearEndRoute].methods[1].reviewedUncertified.independentSecurityReview = "APPROVED"; },
      doc => { doc.allApiRouteFiles[yearEndRoute].methods[0].reviewedUncertified.productionCertified = true; },
      doc => { doc.allApiRouteFiles[yearEndRoute].methods[1].testedBy = { proofPullRequest: 1804 }; },
      doc => { doc.allApiRouteFiles[yearEndRoute].methods[0].reason = "Held."; },
    ];
    for (const tamper of tampers) {
      const candidate = structuredClone(live);
      tamper(candidate);
      assert.throws(() => verifyYearEndHold(candidate), "a tampered year-end hold must fail closed");
    }
    return;
  }
  const alterations = [
    doc => { doc.allApiRouteFiles[yearEndRoute].gitBlobSha = "0".repeat(40); },
    doc => { doc.allApiRouteFiles[yearEndRoute].methods[0].testedBy.workflowRunId++; },
    doc => { doc.allApiRouteFiles[yearEndRoute].methods[0].testedBy.proofBlobSha = "0".repeat(40); },
    doc => { doc.allApiRouteFiles[yearEndRoute].methods[1].testedBy.independentSecurityReview = "APPROVED"; },
    doc => { doc.allApiRouteFiles[yearEndRoute].methods[0].testedBy.productionCertified = true; },
    doc => { doc.allApiRouteFiles[yearEndRoute].methods[1].status = "GAP"; },
  ];
  for (const change of alterations) {
    const candidate = structuredClone(live);
    change(candidate);
    assert.throws(() => verifyYearEndCredits(candidate),
      "source revocation and credit changes must remain fail-closed");
  }
});

test("the year-end re-credit cannot conceal revocation of independent payout evidence", () => {
  const candidate = structuredClone(live);
  const method = candidate.allApiRouteFiles["src/app/api/payout-profiles/route.ts"].methods
    .find(entry => entry.name === "PATCH");
  method.status = "GAP";
  method.testedBy = null;
  candidate.metrics.coveredAfter--;
  candidate.metrics.gap++;
  candidate.acceptanceStatus = candidate.acceptanceStatus.replace(
    "NOT ACCEPTED: " + live.metrics.gap + " API methods",
    "NOT ACCEPTED: " + candidate.metrics.gap + " API methods");
  assert.throws(() => assertLiveTenantCounts(assert, candidate, {},
    { ref: "current main plus year-end", manifest: live }),
    "a separate payout credit cannot be silently downgraded");
});
