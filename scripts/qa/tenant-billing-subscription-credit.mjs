// Read-only, fail-closed reconciliation of two billing POST method receipts.
// This does not run provider traffic, issue a subscription, certify money, or
// authorize production. The execution happened in merged PR #1804 on PG16.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const BILLING_CREDIT_RECEIPT = Object.freeze({
  proofPR: 1804,
  proofHead: "d79db85b2a2ca0276810634dccaf904fd4469099",
  run: 42254118161,
  job: 128016607991,
  evidence: "https://github.com/erwinmehehe/payrollph/actions/runs/42254118161/job/128016607991",
});

export const BILLING_SOURCE_PINS = Object.freeze({
  "src/app/api/billing/subscription/start/route.ts": "b1330831c4e0ee1b58a713427f572ebbac3c14b1",
  "src/app/api/billing/subscription/cancel/route.ts": "29905df9901734a77c4bdb0597b693fb7b65efe7",
  "src/lib/xendit-subscriptions.ts": "f932bf209e09a743a6e64a3e233796e99c952d2d",
  "src/lib/saas-billing-schema.ts": "f7217338b534c3dd303c96484b27daa2e231d68f",
  "src/lib/pricing-catalog.ts": "edc69c934dc18710f7cf3bc12c898c1f95f8b91c",
  "src/lib/saas-pricing.ts": "142f8c9355d51b8ac98be0279dc8eb962e06339d",
  "src/lib/saas-launch-config.ts": "7bb9b9ca56a65c70330bf947e9eaa38c23916efe",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/lib/demo-security.ts": "10f8fa0a7894a66d902ebde5ac4a4e7dee5c1590",
  "src/lib/audit.ts": "3aa8f2c627884072c0c294dbf7861980b302927c",
  "src/lib/crypto.ts": "2316f58f15961e25ffee0353e107e993b630206c",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "src/db/index.ts": "7a5718d0a99ce5b3a7f0f25e385f79a61be807f6",
  "scripts/qa/tenant-billing-subscription-http.mjs": "af648a0cc4b92c58660b55cc7a7b3b9be3085f00",
  "scripts/qa/tenant-billing-subscription-provider-preload.mjs": "b4a55e6163e30d32dde1afd93ba7669df85685e4",
  "tests/tenant-billing-subscription-methods.test.mjs": "2fc556ab8d725b992c9e90553da40e6b85ba6177",
  ".github/workflows/tenant-billing-subscription-methods.yml": "52785de78ff7168d22772ba78a1d9514a6986366",
  "package.json": "7078c01f09c85f79dd79ba5517a80e80cdb72ae3",
  "package-lock.json": "49a688969f37bd3fd690d313970221ff2d5f7fc2",
  // The proof-head Next config differed ONLY by later POS-only no-store
  // overrides, not by any billing route or Xendit provider policy.
  // Re-running exact-head CI is still required; this pin is to current main.
  "next.config.ts": "a61ed6eeefbf0795e94982ae3df55223c9e11dfa",
});

export const BILLING_METHODS = Object.freeze([
  Object.freeze({ path: "src/app/api/billing/subscription/start/route.ts", label: "start",
    own: "realOwnedCheckout201", foreign: "realForeignCheckout403", line: 89 }),
  Object.freeze({ path: "src/app/api/billing/subscription/cancel/route.ts", label: "cancel",
    own: "realOwnedCancellation200", foreign: "realForeignCancellation403", line: 151 }),
]);

function blobHash(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

export function verifyBillingSubscriptionCredits(manifest, read = readFileSync) {
  for (const [path, sha] of Object.entries(BILLING_SOURCE_PINS)) {
    assert.equal(blobHash(read(path)), sha, "Source/proof input drift: " + path);
  }
  const routeEntries = Object.values(manifest.allApiRouteFiles);
  assert.equal(routeEntries.length, manifest.metrics.routeFiles,
    "Route inventory must reconcile dynamically with the manifest");
  assert.equal(routeEntries.reduce((total, r) => total + r.methods.length, 0),
    manifest.metrics.methods, "Method inventory must reconcile dynamically");
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
  const proof = read("scripts/qa/tenant-billing-subscription-http.mjs").toString();
  for (const line of [
    "requireFictionalProviderEnv();",
    "seedEmployer(\"ATTA\"",
    "seedEmployer(\"ATTB\"",
    "seedEmployer(\"VICTIM\"",
    "assert.equal(own.status, 201",
    "assert.equal(cancelled.status, 200",
    "assert.deepEqual(await snapshot(victim.org.id), victimBeforeStart",
    "assert.deepEqual(await snapshot(victim.org.id), victimBeforeCancel",
    "retryWithoutDuplicateProviderCalls: true",
    "victimSqlAndAuditUnchanged: true",
    "methodCredits: 0, productionCertified: false",
  ]) assert.ok(proof.includes(line), "Executed billing proof lost: " + line);
  const transport = read("scripts/qa/tenant-billing-subscription-provider-preload.mjs").toString();
  for (const line of [
    "requireFictionalProviderEnv(",
    "https://api.xendit.co",
    "TENANT_SUBSCRIPTION_REFUSED: unexpected provider method or origin",
    "TENANT_SUBSCRIPTION_REFUSED: unreviewed Xendit endpoint",
  ]) assert.ok(transport.includes(line), "Fake provider egress guard lost: " + line);
  const workflow = read(".github/workflows/tenant-billing-subscription-methods.yml").toString();
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-billing-subscription-http\.mjs/);
  assert.match(workflow, /TENANT_SUBSCRIPTION_PROVIDER_PRELOAD=enabled/);
  const nextConfig = read("next.config.ts").toString();
  assert.match(nextConfig, /source: "\/api\/workforce\/demand-observations\/loyverse"/);
  assert.match(nextConfig, /source: "\/api\/workforce\/demand-observations\/square-sandbox"/);

  for (const item of BILLING_METHODS) {
    const entry = manifest.allApiRouteFiles[item.path];
    assert.equal(entry?.gitBlobSha, BILLING_SOURCE_PINS[item.path], "Route pin changed: " + item.label);
    assert.equal(entry.methods.length, 1, "Only one exported POST: " + item.label);
    const method = entry.methods[0];
    assert.equal(method.name, "POST");
    assert.equal(method.status, "COVERED", "Only accepted provisional method credit: " + item.label);
    const receipt = method.testedBy;
    assert.equal(receipt?.file, "scripts/qa/tenant-billing-subscription-http.mjs");
    assert.equal(receipt?.proofBlobSha, BILLING_SOURCE_PINS["scripts/qa/tenant-billing-subscription-http.mjs"]);
    assert.equal(receipt?.transportBlobSha, BILLING_SOURCE_PINS["scripts/qa/tenant-billing-subscription-provider-preload.mjs"]);
    assert.equal(receipt?.workflowBlobSha, BILLING_SOURCE_PINS[".github/workflows/tenant-billing-subscription-methods.yml"]);
    assert.equal(receipt?.routeBlobSha, BILLING_SOURCE_PINS[item.path]);
    assert.equal(receipt?.workflowRunId, BILLING_CREDIT_RECEIPT.run);
    assert.equal(receipt?.workflowJobId, BILLING_CREDIT_RECEIPT.job);
    assert.equal(receipt?.verifiedPrHeadSha, BILLING_CREDIT_RECEIPT.proofHead);
    assert.equal(receipt?.proofPullRequest, BILLING_CREDIT_RECEIPT.proofPR);
    assert.equal(receipt?.evidence, BILLING_CREDIT_RECEIPT.evidence);
    assert.equal(receipt?.ownPositiveLine, item.line);
    assert.equal(receipt?.independentSecurityReview, "PENDING");
    assert.equal(receipt?.productionTested, false);
    assert.equal(receipt?.providerActual, false);
    assert.equal(receipt?.sourceChangesSinceExecution, "next.config.ts POS-only private/no-store headers");
    assert.equal(receipt?.methodEvidence?.[item.own], 2);
    assert.equal(receipt?.methodEvidence?.[item.foreign], 2);
    assert.equal(receipt?.methodEvidence?.victimSqlAndAuditUnchanged, true);
    assert.equal(receipt?.methodEvidence?.higherIdVictim, true);
  }
  const all = Object.values(manifest.allApiRouteFiles).flatMap(route => route.methods);
  assert.equal(all.length, manifest.metrics.methods);
  assert.equal(all.filter(method => method.status === "COVERED").length, manifest.metrics.coveredAfter);
  assert.equal(all.filter(method => method.status === "GAP").length, manifest.metrics.gap);
  assert.equal(all.filter(method => method.status === "PUBLIC-BY-DESIGN").length, manifest.metrics.publicByDesign);
  return BILLING_METHODS.length;
}
