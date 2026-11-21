import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reviewedDocumentSourceHoldCount } from "../scripts/qa/document-source-accounting.mjs";

const route = "src/app/api/documents/route.ts";
const currentSha = "ad7d168d50cf2dbba1e20c3e4b05d298b66afc02";
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));

test("historical-document metadata source refresh has zero method credits and unchanged archival acceptance", () => {
  const entry = manifest.allApiRouteFiles[route];
  assert.equal(entry.gitBlobSha, currentSha);
  assert.equal(entry.sourceRevisionReview.newRouteBlobSha, currentSha);
  assert.deepEqual(entry.methods.map(m => m.name), ["GET", "POST"]);
  for (const method of entry.methods) {
    assert.equal(method.status, "GAP");
    assert.equal(method.testedBy, null);
    assert.equal(method.reviewedUncertified.coverageCredits, 0);
    assert.equal(method.reviewedUncertified.routeBlobSha, currentSha);
    assert.equal(method.reviewedUncertified.independentSecurityReview, "PENDING");
  }
  assert.ok(reviewedDocumentSourceHoldCount(manifest) >= 6);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
});

test("a fabricated document-list coverage credit cannot use the source-only refresh exception", () => {
  const copy = structuredClone(manifest);
  const method = copy.allApiRouteFiles[route].methods[0];
  method.status = "COVERED";
  method.testedBy = { fabricated: true };
  assert.throws(() => reviewedDocumentSourceHoldCount(copy),
    /Only exact archived zero-credit document holds/);
});

test("a forged document source pin or revision metadata cannot pass the archived receipt checks", () => {
  const copy = structuredClone(manifest);
  copy.allApiRouteFiles[route].sourceRevisionReview.newRouteBlobSha = "0".repeat(40);
  assert.throws(() => reviewedDocumentSourceHoldCount(copy),
    /Only exact archived zero-credit document holds/);

  const alteredSource = (name, ...args) =>
    name === route ? Buffer.from("unreviewed source replacement") : readFileSync(name, ...args);
  assert.throws(() => reviewedDocumentSourceHoldCount(manifest, alteredSource),
    /Only exact archived zero-credit document holds/);
});
