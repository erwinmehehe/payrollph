import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { verifyMoreCredits } from "../scripts/qa/tenant-more-credit-verify.mjs";

// These source pins supplement, NEVER substitute for, completed real PG16 HTTP.
const manifest = JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("exactly four merged final-head PG16/HTTP methods gain distinct provisional credits", () => {
  assertLiveTenantCounts(assert, manifest);
  assert.equal(verifyMoreCredits(manifest), 4);
});

test("tampered source, forged receipt and seventh credit all fail closed", () => {
  const route = "src/app/api/self/schedule-receipts/route.ts";
  const tamper = fn => {
    const modified = structuredClone(manifest);
    fn(modified, modified.allApiRouteFiles[route].methods.find(m => m.name === "GET"));
    assert.throws(() => verifyMoreCredits(modified));
  };
  tamper((_m, entry) => { entry.testedBy.prNumber = 1492; });
  tamper((_m, entry) => { entry.testedBy.foreignDenialLine = 133; });
  tamper((_m, entry) => { entry.testedBy.proofBlobSha = "0".repeat(40); });
  tamper((_m, entry) => { entry.status = "GAP"; });
  tamper((_m, entry) => { entry.testedBy.file = "scripts/qa/tenant-table-http.mjs"; });
  tamper(modified => {
    modified.allApiRouteFiles["src/app/api/invitations/route.ts"].methods
      .find(m => m.name === "POST").testedBy = {
        verifiedMainCommit: "fe3ad8901bfa714d59639d9f59a13cf133eeab36"
      };
  });
  const source = "scripts/qa/tenant-self-schedule-receipts-http.mjs";
  assert.throws(() => verifyMoreCredits(manifest, path =>
    readFileSync(path, "utf8") + (path === source ? "\n// tampered" : "")),
    /reviewed source blob drift/);
});
