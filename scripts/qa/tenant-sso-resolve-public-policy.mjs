/** One explicit owner decision for anonymous OIDC discovery; a historical view never grants execution acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const SSO_RESOLVE_PATH = "src/app/api/auth/sso/resolve/route.ts";
export const SSO_RESOLVE_BLOB = "d9366bd1fe6cb4bf00e33b166969cd1dfc8b0299";
export const SSO_OWNER_APPROVAL = "docs/qa/tenant-sso-resolve-owner-approval.json";
export const SSO_PRIVACY_ARCHIVE = "scripts/qa/tenant-sso-resolve-privacy-archive.json";
export const SSO_EXECUTION_RECEIPT = "scripts/qa/tenant-sso-resolve-executed-receipt.json";
const APPROVAL_BLOB = "d664c4a2d5097887d429c4ac46e63078ca635f70";
const ARCHIVE_BLOB = "afe94128732c46534798c35a5a4e0fc353c517fb";
/** The two proof-run tests read the ledger; their reviewed classification adapters are the only permitted edits. */
const ADAPTERS = {
  "tests/tenant-sso-discovery-contract.test.mjs": "8a5165d8a497d71b0b4c59d42a2fe83c51a2c741",
  "tests/tenant-sso-discovery.test.ts": "3dfd583e440d5caaec1715d7690cc65e4afc207b",
};
const PACKET_BLOB = "9cc204694ceb6228afb0dc7cf5508a9e850f0ff9";

export const blob = (bytes) => createHash("sha1").update("blob " + Buffer.byteLength(bytes) + "\0").update(bytes).digest("hex");

function archive(read) {
  const raw = read(SSO_PRIVACY_ARCHIVE);
  assert.equal(blob(raw), ARCHIVE_BLOB, "Historical SSO resolve hold archive changed");
  const a = JSON.parse(raw);
  assert.equal(a.schema, "sso-resolve-preclassification-archive-v1");
  assert.equal(a.method.status, "GAP");
  assert.equal(a.method.testedBy, null);
  assert.equal(a.method.reviewedUncertified?.kind, "sso-discovery-domain-provider-org-match-PG16-HTTP-uncredited");
  assert.equal(a.method.reviewedUncertified?.routeBlobSha, SSO_RESOLVE_BLOB);
  return a;
}

/** Reads executed inputs: original bytes pass; only the exact reviewed adapters map back to the archived original bytes. */
export function ssoExecutedInputRead(read = readFileSync) {
  const a = archive(read);
  return (path, ...args) => {
    const value = read(path, ...args);
    if (!Object.hasOwn(ADAPTERS, path)) return value;
    if (blob(value) === blob(a.files[path])) return value;
    assert.equal(blob(value), ADAPTERS[path], "SSO discovery adapter source drift: " + path);
    return args[0] ? a.files[path] : Buffer.from(a.files[path]);
  };
}

export function readSsoOwnerApproval(read = readFileSync) {
  const raw = read(SSO_OWNER_APPROVAL);
  assert.equal(blob(raw), APPROVAL_BLOB, "SSO resolve owner decision changed");
  const a = JSON.parse(raw);
  assert.equal(a.status, "APPROVED");
  assert.equal(a.ownerLogin, "erwinmehehe");
  assert.equal(a.authorization.response, "2");
  assert.equal(a.authorization.notIndependentCertification, true);
  assert.equal(a.method, "POST");
  assert.equal(a.route, SSO_RESOLVE_PATH);
  assert.equal(a.routeBlobSha, SSO_RESOLVE_BLOB);
  assert.equal(a.classification, "PUBLIC-BY-DESIGN");
  assert.deepEqual(a.scope, {
    methodsRelabelled: 1, newCoveredCredits: 0, providerNameDisclosed: true, runtimeChanges: false,
    productionActivation: false, providerCalls: false, independentAcceptance: false,
  });
  assert.equal(a.reviewedPacket.gitBlobSha, PACKET_BLOB);
  assert.equal(blob(read(a.reviewedPacket.path)), PACKET_BLOB, "Approved public-field packet changed");
  return a;
}

export function expectedSsoResolveMethod(read = readFileSync) {
  readSsoOwnerApproval(read);
  const original = archive(read).method;
  return {
    name: original.name, line: original.line, status: "PUBLIC-BY-DESIGN",
    reason: "Owner-approved anonymous OIDC discovery: whether an email domain is a verified domain of an enabled OIDC provider, with that provider's ID, its employer-chosen name and a start URL. Everything else returns one identical available:false body. Off by default in production; rate limited. No tenant-private COVERED credit, no SSO activation or independent identity/security acceptance.",
    testedBy: null,
    classificationEvidence: {
      kind: "owner-approved-public-sso-discovery", file: SSO_OWNER_APPROVAL, line: 1,
      approvalBlobSha: APPROVAL_BLOB, routeBlobSha: SSO_RESOLVE_BLOB, executionReceiptFile: SSO_EXECUTION_RECEIPT,
      evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY", coverageCredits: 0, independentlyAccepted: false, productionCertified: false,
    },
    historicalSourceHold: original,
  };
}

/** Shape and decision only; execution is separately mandatory in the classification gate. */
export function verifySsoResolvePolicy(m, read = readFileSync) {
  const entry = m.allApiRouteFiles[SSO_RESOLVE_PATH];
  assert.equal(entry.gitBlobSha, SSO_RESOLVE_BLOB);
  assert.equal(blob(read(SSO_RESOLVE_PATH)), SSO_RESOLVE_BLOB, "The approved route source changed; the approval no longer applies");
  assert.equal(entry.methods.length, 1);
  assert.deepEqual(entry.methods[0], expectedSsoResolveMethod(read), "Only the exact approved SSO discovery contract may be relabelled");
  return 1;
}

/** The only two admissible states: held GAP with no receipt, or exactly the owner-approved public label. */
export function assertSsoResolveHeldOrApproved(m, read = readFileSync) {
  const row = m.allApiRouteFiles[SSO_RESOLVE_PATH].methods.find((r) => r.name === "POST");
  if (row?.status === "PUBLIC-BY-DESIGN") return verifySsoResolvePolicy(m, read);
  assert.equal(row?.status, "GAP", "Owner explicitly held anonymous resolve credit");
  assert.equal(row.testedBy, null);
  return 0;
}

/** Validation-only reconstruction of the original GAP for sealed historical guards; never written to the live ledger. */
export function historicalSsoResolveView(m, read = readFileSync) {
  const view = structuredClone(m);
  const entry = view.allApiRouteFiles[SSO_RESOLVE_PATH];
  if (entry.methods[0].status === "PUBLIC-BY-DESIGN") {
    verifySsoResolvePolicy(m, read);
    entry.methods = [structuredClone(archive(read).method)];
    view.metrics.publicByDesign--;
    view.metrics.gap++;
    view.acceptanceStatus = view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + view.metrics.gap + " API methods");
  }
  return view;
}
