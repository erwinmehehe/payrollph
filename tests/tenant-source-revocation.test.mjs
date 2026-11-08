import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { verifyYearEndCredits } from "../scripts/qa/tenant-year-end-credit.mjs";

const live = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const yearEndRoute = "src/app/api/year-end/route.ts";

test("old #1730 year-end proof stays source-revoked; #1804 adds two new provisional source-pinned receipts", () => {
  assert.equal(verifyYearEndCredits(live), 2);
  assert.deepEqual(live.allApiRouteFiles[yearEndRoute].methods.map(method => [
    method.name, method.status, method.testedBy?.proofPullRequest,
    method.testedBy?.independentlyAccepted,
  ]), [["GET", "COVERED", 1804, false], ["POST", "COVERED", 1804, false]]);
  assert.equal(live.allApiRouteFiles[yearEndRoute].gitBlobSha,
    "f040f5bbbc3df275d32d23f1728b1b0345f77814");
  assertLiveTenantCounts(assert, live);
  assert.equal(live.allApiRouteFiles["src/app/api/payout-profiles/route.ts"].methods
    .find(method => method.name === "PATCH").status, "COVERED");
});

test("current year-end proof refuses changed source, evidence, approval claims and partial credit", () => {
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
