import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyRecoveryCredits } from "../scripts/qa/tenant-merged-recovery-credit.mjs";
import { WPS01_METHOD, WPS01_ROUTE } from "../scripts/qa/tenant-wps01-scenarios-contract.mjs";

test("WPS-01 requires the sealed passing receipt for promotion", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json"));
  const method = manifest.allApiRouteFiles[WPS01_ROUTE]?.methods?.find(x => x.name === "POST");
  assert.equal(WPS01_METHOD, "POST workforce-planning/scenarios");
  assert.equal(verifyRecoveryCredits(manifest),3);
  assert.equal(method?.status,'COVERED');
  assert.equal(method.testedBy.independentSecurityReview,'PENDING',
    'solo fictional proof is never independent acceptance');
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
});
