import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {reviewedPrivateDocumentSourceHold} from "./helpers/tenant-counts.mjs";

const path = "src/app/api/documents/[id]/route.ts";
const current = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
function former() {
  const old = structuredClone(current);
  const currentRow = current.allApiRouteFiles[path];
  const row = old.allApiRouteFiles[path];
  row.gitBlobSha = "0acb38b1396b1e35adf02efd6e033cdd0416e0d0";
  row.methods[0].status = "COVERED";
  row.methods[0].testedBy = structuredClone(currentRow.methods[0].reviewedUncertified.previousMethodProof);
  delete row.methods[0].reviewedUncertified;
  row.sourceRevisionReview = structuredClone(currentRow.sourceRevisionReview.priorActiveMembershipRevision);
  return old;
}

test("only exact changed private document source may withdraw one stale GET credit", () => {
  assert.deepEqual([...reviewedPrivateDocumentSourceHold(former(), current)],
    ["GET " + path]);
  const row = current.allApiRouteFiles[path].methods[0];
  assert.equal(row.status, "GAP");
  assert.equal(row.testedBy, null);
  assert.equal(row.reviewedUncertified.exactHeadPg16Http, "PENDING");
  assert.equal(row.reviewedUncertified.independentSecurityReview, "PENDING");
  assert.equal(row.reviewedUncertified.coverageCredits, 0);
});

test("forged source, receipt, approval and unrelated method downgrades cannot borrow hold", () => {
  for (const changed of [
    m => {m.allApiRouteFiles[path].gitBlobSha = "0".repeat(40);},
    m => {m.allApiRouteFiles[path].methods[0].status = "COVERED";},
    m => {m.allApiRouteFiles[path].methods[0].reviewedUncertified.coverageCredits = 1;},
    m => {m.allApiRouteFiles[path].methods[0].reviewedUncertified.exactHeadPg16Http = "PASS";},
    m => {m.allApiRouteFiles[path].methods[0].reviewedUncertified.independentSecurityReview = "APPROVED";},
    m => {m.allApiRouteFiles[path].methods[0].reviewedUncertified.previousMethodProof = {file:"fabricated.mjs"};},
    m => {m.allApiRouteFiles[path].sourceRevisionReview.noNewMethodCredit = false;},
    m => {m.allApiRouteFiles[path].reviewedUncertified.historicalTransferTests = "fabricated.mjs";},
    m => {m.allApiRouteFiles[path].sourceRevisionReview.historicalTransferSourceReview = "unreviewed";},
  ]) {
    const altered = structuredClone(current);
    changed(altered);
    assert.equal(reviewedPrivateDocumentSourceHold(former(), altered).size, 0);
  }
  const forgedSource = (file) => file === path
    ? Buffer.from(readFileSync(path, "utf8").replace("assertEntityResource(", "skipEntityResource("))
    : readFileSync(file);
  assert.equal(reviewedPrivateDocumentSourceHold(former(), current, forgedSource).size, 0,
    "Any changed runtime guard needs new exact-source approval");
  const unrelated = structuredClone(current);
  const other = unrelated.allApiRouteFiles["src/app/api/hr-cases/route.ts"].methods[0];
  other.status = "GAP";
  assert.deepEqual([...reviewedPrivateDocumentSourceHold(former(), unrelated)],
    ["GET " + path],
    "This helper recognizes only document GET; ordinary global count guard must reject any second downgrade");
});
