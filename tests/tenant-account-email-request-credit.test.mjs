import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { EMAIL_REQUEST_RECEIPT, verifyAccountEmailRequestCredit }
  from "../scripts/qa/tenant-account-email-request-credit.mjs";

const load = () => JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const row = m => m.allApiRouteFiles[EMAIL_REQUEST_RECEIPT.route].methods.find(x => x.name === "POST");

test("distinct account email request POST is provisionally credited only by pinned passing PG16 receipt", () => {
  const m = load();
  assert.equal(verifyAccountEmailRequestCredit(m), 1);
  const methods = Object.values(m.allApiRouteFiles).flatMap(x => x.methods);
  assert.equal(methods.filter(x => x.status === "COVERED").length, m.metrics.coveredAfter);
  assert.equal(methods.filter(x => x.status === "GAP").length, m.metrics.gap);
  assertLiveTenantCounts(assert, m);
  assert.equal(m.allApiRouteFiles["src/app/api/account/email/verify/route.ts"]
    .methods.find(x => x.name === "POST").status, "COVERED",
    "request and verification are distinct methods; do not double count verification");
});

test("missing or fabricated account email proof fails closed", () => {
  for (const change of [
    m => { row(m).status = "GAP"; },
    m => { row(m).reviewedUncertified = { coverageCredits: 0 }; },
    m => { row(m).testedBy.workflowRunId++; },
    m => { row(m).testedBy.evidence += "/not-a-job"; },
    m => { row(m).testedBy.foreignDenialLine = 2; },
    m => { row(m).testedBy.ownPositiveLine = 1; },
    m => { row(m).testedBy.routeBlobSha = "0".repeat(40); },
    m => { m.allApiRouteFiles[EMAIL_REQUEST_RECEIPT.route].gitBlobSha = "0".repeat(40); },
    m => { m.acceptanceStatus = "CERTIFIED"; },
  ]) {
    const m = load();
    change(m);
    assert.throws(() => verifyAccountEmailRequestCredit(m));
  }
});
