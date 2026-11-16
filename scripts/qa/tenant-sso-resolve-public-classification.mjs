/** Exact one-method public relabel, requiring both explicit owner approval and real execution. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { verifySsoResolveExecution, SSO_RESOLVE_EVIDENCE } from "./tenant-sso-resolve-execution-verify.mjs";
import { SSO_RESOLVE_PATH, expectedSsoResolveMethod, verifySsoResolvePolicy, historicalSsoResolveView } from "./tenant-sso-resolve-public-policy.mjs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";

export function verifySsoResolveClassification(m, read = readFileSync) {
  verifySsoResolveExecution(read);
  return verifySsoResolvePolicy(m, read);
}

export function ssoResolveClassificationDelta(before, m, read = readFileSync) {
  const old = before.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0];
  const current = m.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0];
  return current.status === "PUBLIC-BY-DESIGN" && old.status === "GAP" ? verifySsoResolveClassification(m, read) : 0;
}

export { historicalSsoResolveView, SSO_RESOLVE_EVIDENCE };

/** Applies the approved relabel to the ledger only; documentation counts are reconciled by the caller. */
export function classifySsoResolve({ write = false } = {}) {
  const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const before = structuredClone(m.metrics);
  const row = m.allApiRouteFiles[SSO_RESOLVE_PATH].methods[0];
  let changed = false;
  if (row.status === "GAP") {
    assert.ok(write, "Run the approved classification writer");
    verifySsoResolveExecution();
    const old = structuredClone(m.allApiRouteFiles);
    m.allApiRouteFiles[SSO_RESOLVE_PATH].methods = [expectedSsoResolveMethod()];
    for (const [path, entry] of Object.entries(old)) {
      if (path !== SSO_RESOLVE_PATH) assert.deepEqual(m.allApiRouteFiles[path], entry);
    }
    const rows = Object.values(m.allApiRouteFiles).flatMap((e) => e.methods);
    m.metrics.coveredAfter = rows.filter((r) => r.status === "COVERED").length;
    m.metrics.publicByDesign = rows.filter((r) => r.status === "PUBLIC-BY-DESIGN").length;
    m.metrics.gap = rows.filter((r) => r.status === "GAP").length;
    assert.equal(m.metrics.coveredAfter, before.coveredAfter);
    assert.equal(m.metrics.publicByDesign, before.publicByDesign + 1);
    assert.equal(m.metrics.gap, before.gap - 1);
    const sentence = " Owner-approved anonymous OIDC discovery (POST auth/sso/resolve) is one GAP relabelled PUBLIC-BY-DESIGN after real PG16 HTTP proof, zero new COVERED credits; the provider name is a disclosed field; SSO stays off by default and independent identity/security review is PENDING.";
    const status = m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + m.metrics.gap + " API methods");
    // Every page-only note must stay after this sentence (their generators re-derive them).
    const anchor = "Anonymous OIDC resolve remains GAP; no SAML login or production activation.";
    const anchorAt = status.indexOf(anchor);
    assert.ok(anchorAt >= 0, "the SAML sentence must precede every page-only note");
    m.acceptanceStatus = status.slice(0, anchorAt + anchor.length) + sentence + status.slice(anchorAt + anchor.length);
    verifySsoResolveClassification(m);
    writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
    changed = true;
  }
  assert.equal(verifySsoResolveClassification(m), 1);
  return { write, relabelled: changed ? 1 : 0, newCoveredCredits: 0, before, after: m.metrics };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(["--write", "--check"].includes(process.argv[2]));
  console.log(JSON.stringify(classifySsoResolve({ write: process.argv[2] === "--write" })));
}
