/** Exact source-identified OIDC callback proof withdrawal, never a method credit.
 * The earlier synthetic HTTPS/PG16 receipt is immutable, but it cannot
 * certify a callback changed to default-deny. Independent review stays pending.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const OIDC_CALLBACK = "src/app/api/auth/sso/callback/route.ts";
const OLD_CALLBACK = "a27d855a81751498cc907134e8e9dde7400c9f58";
const CURRENT_CALLBACK = "9cb02f681ae8128c8b9c661b057c5591891bdc9e";
const CURRENT_POLICY = "cb94e6854b0387fa749b2fd346ce07db34f64f5b";
const RECEIPT = "scripts/qa/tenant-oidc-full-renewal-receipt.json";
const blob = data => {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
};
const digest = data => createHash("sha256")
  .update(String(data).replaceAll("\r\n", "\n")).digest("hex");

/** Validate the old receipt as historical evidence, not a current-route pass. */
export function verifyOidcHistoricalReceipt(read = readFileSync) {
  assert.equal(digest(read("scripts/qa/tenant-oidc-full-receipt.json", "utf8")),
    "26540730ee86fca67a9e01858867a4d854a61b0afc09dd1d892f3fe646428a27",
    "Historical OIDC receipt changed");
  const raw = read(RECEIPT, "utf8");
  assert.equal(digest(raw),
    "833b92c3ac44cbdca519fd2bea5969ad207449242b59e002e0878df49c1cdcbb",
    "Executed historical OIDC receipt changed");
  const r = JSON.parse(String(raw));
  assert.equal(r.sourceCommit, "d46ed24b239b47a2182b868f399f3cbb1d706ca0");
  assert.equal(r.workflowRunId, 43251981343);
  assert.equal(r.workflowJobId, 131299924274);
  assert.equal(r.jobConclusion, "success");
  assert.equal(r.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/43251981343/job/131299924274");
  assert.equal(r.method, "GET auth/sso/callback");
  assert.equal(r.evidenceClassification, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.deepEqual([r.ownLogins, r.refusedCallbacks, r.authenticatedForeignReadsDenied], [2, 43, 2]);
  assert.equal(r.coverageCredits, 0);
  assert.equal(r.realProviderCalls, 0);
  assert.equal(r.transportMocks, false);
  assert.equal(r.independentSecurityReview, "PENDING");
  assert.equal(r.productionCertified, false);
  assert.equal(Object.keys(r.proofInputs).length, 11);
  assert.equal(Object.keys(r.additionalInputs).length, 16);
  return r;
}

/** Prove the precise zero-credit, default-OFF callback hold and every recorded pin. */
export function verifyOidcCallbackHold(manifest, read = readFileSync) {
  const entry = manifest.allApiRouteFiles?.[OIDC_CALLBACK];
  assert.equal(entry?.gitBlobSha, CURRENT_CALLBACK,
    "Only the exact reviewed SSO callback source may withdraw its old credit");
  assert.equal(entry?.methods?.length, 1);
  const method = entry.methods[0];
  assert.equal(method.name, "GET");
  assert.equal(method.status, "GAP", "Changed SSO callback cannot inherit old coverage");
  assert.equal(method.testedBy, null, "No stale IdP receipt can earn a current credit");
  assert.match(method.reason, /Zero current method credits/i);
  const review = method.reviewedUncertified;
  assert.equal(review?.kind, "oidc-initiating-browser-state-binding-zero-credit");
  assert.equal(review.originalRouteBlobSha, OLD_CALLBACK);
  assert.equal(review.routeBlobSha, CURRENT_CALLBACK);
  assert.equal(review.credits, 0);
  assert.equal(review.exactHeadPg16Http, "PENDING");
  assert.equal(review.independentSecurityReview, "PENDING");
  assert.equal(review.productionCertified, false);
  const linked = review.linkedIdentityBoundary;
  assert.equal(linked?.kind, "oidc-provider-employer-scoped-identity-link-preserved-but-source-changed");
  assert.equal(linked.sourceSha, CURRENT_CALLBACK);
  assert.equal(linked.priorCreditedRouteBlobSha, OLD_CALLBACK);
  assert.equal(linked.priorSyntheticReceipt, RECEIPT);
  assert.equal(linked.priorSyntheticJob,
    "https://github.com/erwinmehehe/payrollph/actions/runs/43251981343/job/131299924274");
  assert.equal(linked.priorProofSuperseded, true);
  assert.equal(linked.accepted, false);
  assert.equal(linked.credits, 0);
  assert.equal(linked.productionCertified, false);

  const pins = [
    ["cookieHelperFile", "cookieHelperBlobSha",
      "src/lib/oidc-browser-state.ts", "cd772e6bed14633cc4fc7546140e16770ff54c3f"],
    ["contractFile", "contractBlobSha",
      "scripts/qa/tenant-oidc-browser-state-contract.mjs", "8e0534925f6092748af9337e5fae227876388530"],
    ["proofFile", "proofBlobSha",
      "scripts/qa/tenant-oidc-browser-state-http.mjs", "edaff42c189e48daf7560f1ae8e9784fbc2810b1"],
    ["unitTestFile", "unitTestBlobSha",
      "tests/tenant-oidc-browser-state.test.ts", "f82c666418c4f0dd5f9f369146ad1748b9f542e6"],
    ["negativeTestFile", "negativeTestBlobSha",
      "tests/tenant-oidc-browser-state-contract.test.mjs", "b89879de534005a17f4164df51eb1dca647fbb33"],
    ["workflowFile", "workflowBlobSha",
      ".github/workflows/tenant-oidc-browser-state-http.yml", "f02241ffc3e16cf79c9ef67d1cc35c3681501194"],
  ];
  for (const [fileField, hashField, path, expectedSha] of pins) {
    assert.equal(review[fileField], path);
    assert.equal(review[hashField], expectedSha);
    assert.equal(blob(read(path)), expectedSha,
      "OIDC uncredited review source drift; renew security evidence: " + path);
  }

  const callback = String(read(OIDC_CALLBACK));
  assert.equal(blob(callback), CURRENT_CALLBACK, "OIDC callback hold source changed");
  const gate = callback.indexOf("if (!oidcSsoRuntimeEnabled()) return oidcSsoDisabledResponse();");
  assert.ok(gate > callback.indexOf("export async function GET(") &&
    gate < callback.indexOf("new URL(request.url)"),
    "Default-OFF hold must precede any callback input or database access");
  assert.ok(callback.includes("persistVerifiedOidcIdentity("),
    "Employer-scoped callback identity persistence must survive the hold");
  const policy = String(read("src/lib/oidc-sso-runtime.ts"));
  assert.equal(blob(policy), CURRENT_POLICY, "OIDC runtime policy source changed");
  assert.ok(policy.includes('enabledValue: "enabled"'),
    "Only explicitly enabled runtime mode may reach OIDC");
  verifyOidcHistoricalReceipt(read);
  return 0;
}
