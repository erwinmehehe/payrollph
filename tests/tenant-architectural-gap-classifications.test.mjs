import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyArchitecturalRelabelDelta, readArchitecturalOwnerApproval, OWNER_APPROVAL_FILE } from "./helpers/tenant-architectural-classification-delta.mjs";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const prelogin = [
  ["src/app/api/setup/route.ts", "GET"],
  ["src/app/api/setup/route.ts", "POST"],
  ["src/app/api/intake-challenge/route.ts", "POST"],
  ["src/app/api/signup/route.ts", "POST"],
  ["src/app/api/signup/resend/route.ts", "POST"],
  ["src/app/api/signup/verify/route.ts", "POST"],
];
const disabledSaml = [
  ["src/app/api/auth/saml/start/[providerId]/route.ts", "GET"],
  ["src/app/api/auth/saml/acs/[providerId]/route.ts", "POST"],
];
const worker = ["src/app/api/hcm/work-items/escalate/route.ts", "POST"];

const hash = path => {
  const buf = readFileSync(path);
  return createHash("sha1").update("blob " + buf.length + "\0").update(buf).digest("hex");
};
const method = ([path, verb]) => {
  const record = manifest.allApiRouteFiles[path];
  assert.equal(record.gitBlobSha, hash(path), "Route changes require re-inventory: " + path);
  const row = record.methods.find(item => item.name === verb);
  assert.ok(row, "Missing " + verb + " " + path);
  return row;
};

test("six public pre-login classifications are bound to identical merged PG16 source/proof and earn zero tenant credits", () => {
  for (const item of prelogin) {
    const row = method(item), c = row.classificationEvidence;
    assert.equal(row.status, "PUBLIC-BY-DESIGN");
    assert.equal(row.testedBy, null);
    assert.equal(c?.category, "public-prelogin-source-and-PG16");
    assert.equal(c.sourceBlobSha, hash(item[0]));
    assert.equal(c.proofBlobSha, hash(c.proofFile));
    assert.equal(c.workflowBlobSha, hash(c.workflowFile));
    assert.equal(c.proofRun, "https://github.com/erwinmehehe/payrollph/actions/runs/43134412313/job/130906150181");
    assert.equal(c.methodCoverageCredits, 0);
    assert.equal(c.productionCertified, false);
    assert.equal(c.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.match(row.reason, /not a tenant-private COVERED credit/i);
  }
  const proof = readFileSync("scripts/qa/tenant-prelogin-http.mjs", "utf8");
  for (const marker of [
    "requireDisposablePrelogin();", "coverageCredits: 0",
    "assertRowsUnchanged(victimBefore, await snapshot(victim)",
    "PUBLIC_SIGNUP_MODE", // negative profile check in the imported contract
  ].slice(0, 3)) assert.ok(proof.includes(marker), marker);
  const contract = readFileSync("scripts/qa/tenant-prelogin-contract.mjs", "utf8");
  assert.match(contract, /PUBLIC_SIGNUP_MODE !== "pilot"/);
  assert.match(contract, /SMTP_URL must be the loopback sink/);
});

test("two disabled SAML provider endpoints are public no-data refusals, not metadata or successful login credits", () => {
  for (const item of disabledSaml) {
    const row = method(item), c = row.classificationEvidence, src = readFileSync(item[0], "utf8");
    assert.equal(row.status, "PUBLIC-BY-DESIGN");
    assert.equal(row.testedBy, null);
    assert.equal(c?.methodCoverageCredits, 0);
    assert.equal(c?.activeSamlLoginProven, false);
    assert.equal(c?.sourceBlobSha, hash(item[0]));
    assert.equal(c?.boundaryBlobSha, hash(c.boundaryFile));
    assert.equal(c?.testBlobSha, hash(c.testFile));
    assert.match(src, /samlDisabledBoundaryResponse\(\)/);
    assert.doesNotMatch(src, /identityProviders|db\.select|buildSamlServiceProviderMetadata/);
  }
  assert.equal(method(["src/app/api/auth/saml/metadata/[providerId]/route.ts", "GET"]).status, "GAP",
    "Metadata exposes provider existence and must not borrow disabled-login evidence");
});

test("HCM SLA cron is a privileged global token-only operation, never an employer-session credit", () => {
  const row = method(worker), p = row.privilegedOperation;
  assert.equal(row.status, "PRIVILEGED-OPERATIONS-TOKEN-ONLY");
  assert.equal(row.testedBy, null);
  assert.equal(p?.methodCoverageCredits, 0);
  assert.equal(p?.credentialEnvironment, "HCM_SLA_CRON_SECRET");
  assert.equal(p?.requiredHeader, "authorization");
  assert.equal(p?.proofBlobSha, hash(p.denialHarness));
  assert.equal(p?.contractBlobSha, hash(p.contractFile));
  assert.equal(p?.productionCertified, false);
  const src = readFileSync(worker[0], "utf8");
  assert.ok(src.indexOf("if (!authorized(request))") < src.indexOf("const client = await pool.connect()"));
  assert.doesNotMatch(src, /getSessionUser\(/);
});

test("all classifications reconcile dynamically, without silently crediting any of these nine methods", () => {
  const tally = {};
  for (const route of Object.values(manifest.allApiRouteFiles)) {
    for (const row of route.methods) tally[row.status] = (tally[row.status] || 0) + 1;
  }
  assert.equal(tally.COVERED, manifest.metrics.coveredAfter);
  assert.equal(tally["PUBLIC-BY-DESIGN"], manifest.metrics.publicByDesign);
  assert.equal(tally["PRIVILEGED-OPERATIONS-TOKEN-ONLY"], manifest.metrics.privilegedOperationsTokenOnly);
  assert.equal(tally.GAP, manifest.metrics.gap);
  assert.equal(Object.values(tally).reduce((a, b) => a + b, 0), manifest.metrics.methods);
  assert.match(manifest.acceptanceStatus, new RegExp("^NOT ACCEPTED: " + tally.GAP + " API methods"));
});


test("the recorded owner decision cannot be expanded into credits, other methods or activation", () => {
  const record = readArchitecturalOwnerApproval(assert);
  assert.equal(record.classifications.length, 9);
  assert.equal(record.authorization.response, "Approve the nine labels");
  for (const mutate of [
    r => r.ownerLogin = "someone-else",
    r => r.approvedOn = "2099-12-31",
    r => r.authorization.response = "not approved",
    r => r.scope.productionActivation = true,
    r => r.scope.newTenantCoveredCredits = 1,
    r => r.scope.independentSecurityCertification = true,
    r => r.classifications.pop(),
    r => r.classifications.push({ path: "unapproved", method: "GET", classification: "PUBLIC-BY-DESIGN" }),
    r => r.classifications[0].routeBlobSha = "0".repeat(40),
    r => r.classifications[0].classification = "COVERED",
    r => r.reviewedPacket.commit = "0".repeat(40),
  ]) {
    const forged = structuredClone(record); mutate(forged);
    assert.throws(() => readArchitecturalOwnerApproval(assert, path =>
      path === OWNER_APPROVAL_FILE ? Buffer.from(JSON.stringify(forged)) : readFileSync(path)),
      /Owner decision changed/);
  }
});
const proposedMethods = [...prelogin, ...disabledSaml, worker];
const candidate = (m, [path, verb]) => m.allApiRouteFiles[path].methods.find(row => row.name === verb);
function historicalGaps() {
  const before = structuredClone(manifest);
  for (const target of proposedMethods) candidate(before, target).status = "GAP";
  return before;
}

test("the exact nine owner-approved labels reconcile once and remain source-validated after integration", () => {
  assert.deepEqual(verifyArchitecturalRelabelDelta(assert, historicalGaps(), manifest),
    { gapRelabels: 9, publicByDesign: 8, privilegedTokenOnly: 1 });
  assert.deepEqual(verifyArchitecturalRelabelDelta(assert, manifest, manifest),
    { gapRelabels: 0, publicByDesign: 0, privilegedTokenOnly: 0 });
});

test("classification cannot invent coverage, approve itself, change source or retire a tenth method", () => {
  const cases = [
    ["invented coverage", m => { candidate(m, prelogin[0]).status = "COVERED"; }],
    ["invented receipt", m => { candidate(m, prelogin[0]).testedBy = { file: "invented" }; }],
    ["changed source", m => { m.allApiRouteFiles[prelogin[0][0]].gitBlobSha = "0".repeat(40); }],
    ["wrong worker class", m => { candidate(m, worker).status = "PUBLIC-BY-DESIGN"; }],
    ["invented approval date", m => { candidate(m, worker).privilegedOperation.approvedOn = "2099-12-31"; }],
    ["missing approval record", m => { delete candidate(m, prelogin[0]).classificationEvidence.ownerApprovalRecord; }],
    ["forged approval record", m => { candidate(m, prelogin[0]).classificationEvidence.ownerApprovalRecord.blobSha = "0".repeat(40); }],
    ["wrong worker credential", m => { candidate(m, worker).privilegedOperation.credentialEnvironment = "SESSION_COOKIE"; }],
    ["wrong worker proof", m => { candidate(m, worker).privilegedOperation.proofBlobSha = "0".repeat(40); }],
    ["wrong proof head", m => { candidate(m, prelogin[0]).classificationEvidence.proofHead = "0".repeat(40); }],
    ["wrong executed job", m => { candidate(m, prelogin[0]).classificationEvidence.proofRun = "https://example.invalid/fake"; }],
    ["wrong proof bytes", m => { candidate(m, prelogin[0]).classificationEvidence.proofBlobSha = "0".repeat(40); }],
    ["changed workflow", m => { candidate(m, prelogin[0]).classificationEvidence.workflowBlobSha = "0".repeat(40); }],
    ["arbitrary proof path", m => { candidate(m, prelogin[0]).classificationEvidence.proofFile = "unreviewed.mjs"; }],
    ["fake SAML success", m => { candidate(m, disabledSaml[0]).classificationEvidence.activeSamlLoginProven = true; }],
    ["missing method", m => { m.allApiRouteFiles[prelogin[0][0]].methods = []; }],
    ["unrelated metadata retirement", m => { candidate(m, ["src/app/api/auth/saml/metadata/[providerId]/route.ts", "GET"]).status = "PUBLIC-BY-DESIGN"; }],
  ];
  for (const [label, mutate] of cases) {
    const forged = structuredClone(manifest); mutate(forged);
    assert.throws(() => verifyArchitecturalRelabelDelta(assert, historicalGaps(), forged), { name: "AssertionError" }, label);
  }
});

test("already-present labels still reject evidence tampering instead of bypassing verification", () => {
  for (const target of proposedMethods) {
    for (const [field, value] of [["productionCertified", true], ["methodCoverageCredits", 1],
      ["classificationApproval", "APPROVED"], ["independentSecurityReview", "APPROVED"]]) {
      const forged = structuredClone(manifest), row = candidate(forged, target);
      const evidence = row.classificationEvidence ?? row.privilegedOperation;
      evidence[field] = value;
      assert.throws(() => verifyArchitecturalRelabelDelta(assert, manifest, forged), { name: "AssertionError" },
        target.join(" ") + ": " + field);
    }
  }
});
