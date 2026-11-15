import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SSO_OWNER_APPROVAL, SSO_PRIVACY_ARCHIVE, SSO_RESOLVE_PATH, blob, expectedSsoResolveMethod,
  historicalSsoResolveView, readSsoOwnerApproval, verifySsoResolvePolicy,
} from "../scripts/qa/tenant-sso-resolve-public-policy.mjs";

const manifest = () => JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
/** The proposal the writer would produce from the GAP ledger. */
function proposal() {
  const m = manifest();
  const row = m.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0];
  if (row.status === "GAP") {
    m.allApiRouteFiles[SSO_RESOLVE_PATH].methods = [expectedSsoResolveMethod()];
    m.metrics.publicByDesign++;
    m.metrics.gap--;
  }
  return m;
}

test("the owner approval is exact, pins the reviewed packet and approves only this one public label", () => {
  const a = readSsoOwnerApproval();
  assert.equal(a.authorization.response, "2");
  assert.equal(a.scope.newCoveredCredits, 0);
  assert.equal(a.scope.providerNameDisclosed, true);
  assert.ok(a.publicFields.some(f => f.startsWith("providerName")), "the approval must name the provider name disclosure");
  const route = readFileSync(SSO_RESOLVE_PATH, "utf8");
  assert.ok(route.includes("providerName: match.providerName"), "the approved contract includes providerName; a changed route needs a new decision");
});

test("the approved method is a zero-credit public label that keeps the original hold as history", () => {
  const method = expectedSsoResolveMethod();
  assert.equal(method.status, "PUBLIC-BY-DESIGN");
  assert.equal(method.testedBy, null);
  assert.equal(method.classificationEvidence.coverageCredits, 0);
  assert.equal(method.classificationEvidence.independentlyAccepted, false);
  assert.equal(method.classificationEvidence.productionCertified, false);
  assert.equal(method.historicalSourceHold.status, "GAP");
  assert.equal(verifySsoResolvePolicy(proposal()), 1);
});

test("the historical view reconstructs the exact original GAP without touching other methods", () => {
  const m = proposal();
  const view = historicalSsoResolveView(m);
  const row = view.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0];
  assert.equal(row.status, "GAP");
  assert.deepEqual(row, JSON.parse(readFileSync(SSO_PRIVACY_ARCHIVE, "utf8")).method);
  assert.equal(view.metrics.gap, m.metrics.gap + 1);
  assert.equal(view.metrics.publicByDesign, m.metrics.publicByDesign - 1);
  for (const [path, entry] of Object.entries(m.allApiRouteFiles)) {
    if (path !== SSO_RESOLVE_PATH) assert.deepEqual(view.allApiRouteFiles[path], entry);
  }
});

test("a forged label, a credit, an extra method, a changed route or a changed decision is refused", () => {
  for (const mutate of [
    m => { m.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0].status = "COVERED"; },
    m => { m.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0].classificationEvidence.coverageCredits = 1; },
    m => { m.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0].testedBy = { file: "x" }; },
    m => { m.allApiRouteFiles[SSO_RESOLVE_PATH].methods.push({ name: "GET", status: "PUBLIC-BY-DESIGN" }); },
    m => { m.allApiRouteFiles[SSO_RESOLVE_PATH].gitBlobSha = "0".repeat(40); },
    m => { m.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0].historicalSourceHold.status = "COVERED"; },
  ]) {
    const m = proposal();
    mutate(m);
    assert.throws(() => verifySsoResolvePolicy(m));
  }
  for (const path of [SSO_OWNER_APPROVAL, SSO_PRIVACY_ARCHIVE, SSO_RESOLVE_PATH]) {
    const read = name => name === path ? Buffer.concat([readFileSync(name), Buffer.from("\n")]) : readFileSync(name);
    assert.throws(() => verifySsoResolvePolicy(proposal(), read), undefined, "tampered " + path);
  }
});

test("the approval cannot be reused for another route or method", () => {
  const a = readSsoOwnerApproval();
  assert.equal(a.route, SSO_RESOLVE_PATH);
  assert.equal(a.method, "POST");
  assert.equal(blob(Buffer.from("x")) === a.routeBlobSha, false);
});
