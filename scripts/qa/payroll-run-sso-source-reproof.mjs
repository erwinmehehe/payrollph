/**
 * Source-only equivalence for one reviewed OFF-mode SSO probe change.
 * Old payroll-run method receipts remain historical. This does not mark new
 * coverage, certify OIDC, or authorize a rollout. The changed caller was
 * independently exercised in disposable PG16/localhost HTTP at the exact
 * source commit cited below; all other historical proof inputs stay sealed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renewalBlob } from "./payroll-run-renewal-inputs.mjs";

const COMPAT = "scripts/qa/payroll-run-oracle-source-compat.mjs";
const CALLER = "scripts/qa/tenant-second-pass-http.mjs";
const HISTORICAL = Object.freeze({
  [COMPAT]: "bf33eadf192888db0924c40df894c4ea38ea28aa",
  [CALLER]: "b053035fa0b0d3a0390c595fb34000206d3c3330",
});
const CURRENT = Object.freeze({
  [COMPAT]: "8d4f71c58531256d5db3ca22f0d6bd0661943ca3",
  [CALLER]: "1f4c7cf87104d0fdc7d6362310827a7935afeeb1",
});
const COMPAT_INSERTION = "  // Compose the separate default-OFF SSO expectation with the oracle edits.\n  // Both full source hashes and the exact reconstructed intermediate hash are\n  // required. This neither changes an HMO assertion nor renews a payroll credit.\n  if (path === \"scripts/qa/tenant-second-pass-http.mjs\" &&\n      blob(source) === \"1f4c7cf87104d0fdc7d6362310827a7935afeeb1\") {\n    const held = '        expectStatus(result, key === \"POST auth/sso/resolve\" && process.env.OIDC_SSO_RUNTIME_MODE !== \"enabled\" ? 503 : 200, \"Public/auth-status or held SSO endpoint \" + key);';\n    const original = '        expectStatus(result, 200, \"Intentionally public/auth-status endpoint \" + key);';\n    assert.equal(source.split(held).length, 2, \"Exactly one reviewed disabled-SSO expectation\");\n    source = source.replace(held, original);\n    assert.equal(blob(source), record.currentBlob, \"SSO/oracle composition must reconstruct the sealed intermediate caller\");\n  }\n";
const CALLER_CURRENT_LINE = "        expectStatus(result, key === \"POST auth/sso/resolve\" && process.env.OIDC_SSO_RUNTIME_MODE !== \"enabled\" ? 503 : 200, \"Public/auth-status or held SSO endpoint \" + key);";
const CALLER_HISTORICAL_LINE = "        expectStatus(result, 200, \"Intentionally public/auth-status endpoint \" + key);";

export const reviewedSsoCallerProof = Object.freeze({
  kind: "reviewed-default-off-sso-caller-source-compatibility",
  sourceHead: "dcbc4d7c60ac751c043f5714ca0307d7005e0bf2",
  runId: 43416581727,
  jobId: 131855897124,
  evidence: "https://github.com/erwinmehehe/payrollph/actions/runs/43416581727/job/131855897124",
  conclusion: "success",
  postgresMajor: 16,
  transport: "localhost-http",
  result: Object.freeze({
    result: "PASS",
    kind: "SYNTHETIC_REAL_HTTP_ONLY",
    inventoriedRoutes: 42,
    probedHttpMethods: 50,
    attackerOrganizations: 2,
    assertions: 1105,
    victimOnlyIdsAboveSix: Object.freeze([8, 8, 8, 8, 11, 16]),
    humanUatAccepted: false,
    externalProviderAccepted: false,
    productionApproved: false,
  }),
  previouslyCoveredReproofCredits: 0,
  independentlyAccepted: false,
  productionCertified: false,
});

function replaceExactlyOne(source, oldText, replacement, name) {
  assert.equal(source.split(oldText).length, 2, name + " must contain exactly one reviewed edit");
  return source.replace(oldText, replacement);
}

/**
 * Two exact blob hashes and bit-for-bit reconstruction to the old verified
 * closure are required. A changed status, assertion, import or other source
 * byte fails rather than inheriting the historical payroll-run receipt.
 */
export function verifyReviewedHeldSsoCallerSource(read = readFileSync) {
  const compat = String(read(COMPAT));
  const caller = String(read(CALLER));
  assert.equal(renewalBlob(compat), CURRENT[COMPAT], "SSO oracle compatibility changed; require fresh evidence");
  assert.equal(renewalBlob(caller), CURRENT[CALLER], "SSO second-pass caller changed; require fresh evidence");
  const previousCompat = replaceExactlyOne(compat, COMPAT_INSERTION, "", "oracle helper");
  const previousCaller = replaceExactlyOne(caller, CALLER_CURRENT_LINE, CALLER_HISTORICAL_LINE, "second-pass probe");
  assert.equal(renewalBlob(previousCompat), HISTORICAL[COMPAT], "prior compatibility helper did not reconstruct");
  assert.equal(renewalBlob(previousCaller), HISTORICAL[CALLER], "prior second-pass probe did not reconstruct");
  assert.equal(reviewedSsoCallerProof.conclusion, "success");
  assert.equal(reviewedSsoCallerProof.result.result, "PASS");
  assert.equal(reviewedSsoCallerProof.result.probedHttpMethods, 50);
  assert.equal(reviewedSsoCallerProof.result.attackerOrganizations, 2);
  assert.ok(reviewedSsoCallerProof.result.assertions >= 1105);
  assert.equal(reviewedSsoCallerProof.previouslyCoveredReproofCredits, 0);
  assert.equal(reviewedSsoCallerProof.independentlyAccepted, false);
  return HISTORICAL;
}

/** Used ONLY for two otherwise historical exact-source pins in the existing
 * secondPass renewal cohort. Every other input still must match byte for byte. */
export function isReviewedHeldSsoSecondPassInput(cohortName, file, expectedHistoricalBlob, read = readFileSync) {
  if (cohortName !== "secondPass" || !Object.hasOwn(HISTORICAL, file)) return false;
  const old = verifyReviewedHeldSsoCallerSource(read);
  return old[file] === expectedHistoricalBlob;
}
