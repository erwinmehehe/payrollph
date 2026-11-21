/**
 * Additive, zero-credit review inventory for the disabled Operations Copilot.
 *
 * The historic 295-route / 21-page tenant proof ledger is source-sealed by
 * independent workflows and must not be silently repinned or edited merely
 * to make a new pilot pass CI. This supplement inventories the EXACT new
 * sources as unaccepted GAPs and blocks unreviewed source changes. It grants
 * NO method/page credits and NO production rollout authority.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const OPERATIONS_COPILOT_SUPPLEMENT =
  "scripts/qa/operations-copilot-isolation-supplement.json";
const ORIGINAL_LEDGER = "scripts/qa/tenant-isolation-coverage-manifest.json";
const ORIGINAL_LEDGER_SHA = "df3e1301b67ec1b2c271f4393f91511b7e8035c5";
// Existing upstream ledger after GitHub synthesizes PR-into-main test merges.
// This is one exact reviewed Git blob, not permission to accept future repins.
const UPSTREAM_LEDGER_SHA = "c8722f5420ec6584b3c1ebdff76fc5d508a762a5";
const ROUTE = "src/app/api/operations-copilot/route.ts";
const PAGE = "src/app/hcm/operations-copilot/page.tsx";
const LIB = "src/lib/operations-copilot.ts";
const MODEL = "src/lib/operations-copilot-ai.ts";
const CLIENT = "src/components/operations-copilot-panel.tsx";
const SUPPORT = [LIB, MODEL, CLIENT];

function gitBlobSha(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

function exactStringArray(actual, expected, name) {
  assert.deepEqual(actual, expected, name + " changed without reviewed source evidence");
}

function requireFragments(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(source.includes(token), label + ": missing source boundary " + token);
  }
}

/**
 * This validates the supplementary inventory, not an isolation proof.
 * Reading it twice with different fixture data must never grant a method
 * status other than GAP. Production remains hard-disabled in the source.
 */
export function verifyOperationsCopilotReviewOnly(read = readFileSync) {
  const s = JSON.parse(String(read(OPERATIONS_COPILOT_SUPPLEMENT)));
  assert.equal(s.schema, "linaw-operations-copilot-zero-credit-supplement-v1");
  assert.equal(s.baselineManifestBlob, ORIGINAL_LEDGER_SHA);
  assert.equal(s.upstreamManifestBlob, UPSTREAM_LEDGER_SHA);
  const actualLedgerSha = gitBlobSha(read(ORIGINAL_LEDGER));
  assert.ok(actualLedgerSha === ORIGINAL_LEDGER_SHA || actualLedgerSha === UPSTREAM_LEDGER_SHA,
    "Original executed tenant evidence was modified; do not re-credit without fresh proof");
  assert.equal(s.status, "UNACCEPTED_LOCAL_ONLY");
  assert.equal(s.exactHeadRealHttpProof, "NOT_RUN");
  assert.equal(s.independentSecurityReview, "PENDING");
  assert.equal(s.independentPayrollPrivacyReview, "PENDING");
  assert.equal(s.productionCertified, false);
  assert.equal(s.productionEnabled, false);
  assert.equal(s.newApiMethodCredits, 0);
  assert.equal(s.newPageCredits, 0);
  exactStringArray(Object.keys(s).sort(), [
    "apiRoutes", "baselineManifestBlob", "exactHeadRealHttpProof",
    "independentPayrollPrivacyReview", "independentSecurityReview",
    "newApiMethodCredits", "newPageCredits", "productionCertified",
    "productionEnabled", "reviewRequired", "schema", "scopedPages",
    "status", "supportingSourcePins", "upstreamManifestBlob",
  ], "review-only schema");
  assert.ok(Array.isArray(s.reviewRequired) && s.reviewRequired.length === 4);

  assert.ok(Array.isArray(s.apiRoutes) && s.apiRoutes.length === 1);
  assert.ok(Array.isArray(s.scopedPages) && s.scopedPages.length === 1);
  assert.ok(Array.isArray(s.supportingSourcePins) && s.supportingSourcePins.length === SUPPORT.length);
  const api = s.apiRoutes[0];
  const page = s.scopedPages[0];
  assert.equal(api.path, ROUTE);
  assert.equal(page.path, PAGE);
  exactStringArray(api.methods.map(m => m.name), ["GET", "POST"], "copilot HTTP methods");
  assert.equal(page.status, "GAP");
  assert.equal(page.credits, 0);
  assert.equal(page.testedBy, null);
  assert.equal(page.hasAction, false);
  for (const method of api.methods) {
    assert.equal(method.status, "GAP", "No tenant method credit without real own/victim HTTP");
    assert.equal(method.testedBy, null);
    assert.equal(method.credits, 0);
    assert.ok(typeof method.reason === "string" && method.reason.length >= 90);
  }
  assert.ok(typeof page.reason === "string" && page.reason.length >= 90);

  const sources = [
    { path: api.path, blob: api.blob },
    { path: page.path, blob: page.blob },
    ...s.supportingSourcePins,
  ];
  exactStringArray(
    s.supportingSourcePins.map(p => p.path),
    SUPPORT, "supporting sources",
  );
  for (const pin of sources) {
    assert.match(pin.blob, /^[0-9a-f]{40}$/, pin.path + " needs a Git blob SHA");
    assert.equal(gitBlobSha(read(pin.path)), pin.blob,
      pin.path + ": source changed; renew tenant isolation review instead of silently carrying GAP metadata");
  }

  const routeSource = String(read(ROUTE));
  const pageSource = String(read(PAGE));
  const libSource = String(read(LIB));
  const modelSource = String(read(MODEL));
  const clientSource = String(read(CLIENT));

  // Reject any accidental production activation while the evidence remains NOT_RUN.
  const denyProduction = 'if (env.NODE_ENV === "production") return false;';
  requireFragments(libSource, [
    denyProduction,
    "OPERATIONS_COPILOT_PILOT_ORG_IDS",
    "OPERATIONS_COPILOT_AI_PILOT_ORG_IDS",
    "tenantInPilotList(organizationId, env.OPERATIONS_COPILOT_PILOT_ORG_IDS)",
    "automationModelAllowedForOrganization(organizationId, env)",
  ], "unaccepted tenant-local pilot gate");
  assert.ok(libSource.indexOf(denyProduction) <
    libSource.indexOf("return tenantInPilotList(organizationId, env.OPERATIONS_COPILOT_PILOT_ORG_IDS)"),
    "Production must be denied BEFORE evaluating even a configured tenant allowlist");

  // Both methods repeat the session, role, unit and real legal-employer checks
  // before reading financial sources; HR is company-wide and tenant-filtered.
  requireFragments(routeSource, [
    "export async function GET(",
    "export async function POST(",
    "if (!operationsCopilotEnabled(organizationId))",
    "getSessionUser()",
    "assertOrganizationRole(",
    "assertOrganizationUnitAccess(",
    "findPayrollRunForMember(",
    "requireRunEmployer({",
    "access?.companyWide",
    "WHERE organization_id = $1",
    "buildPayrollAssurance(",
    "operationsCopilotAiAllowed(authorized.brief.organizationId)",
    "enforceSameOriginMutation(request)",
    "requireSensitiveActionMfa(authorized.user)",
    "enforceSensitiveActionRateLimit(request",
    '"Cache-Control": "private, no-store"',
  ], "read-only API contract");
  for (const disallowed of [
    "export async function PATCH(", "export async function DELETE(",
    "export async function PUT(", "db.update(", "db.insert(",
    "drainPayrollQueue(", "enqueuePayrollRun(", "db.delete(",
  ]) assert.equal(routeSource.includes(disallowed), false,
    "An unaccepted read-only pilot must not introduce an active write path: " + disallowed);

  requireFragments(pageSource, [
    "operationsCopilotEnabled(organizationId)",
    "getSessionUser()",
    "assertOrganizationRole(",
    "assertOrganizationUnitAccess(",
    "findPayrollRunForMember(",
    "if (!access?.companyWide) notFound()",
    "OperationsCopilotPanel",
  ], "SSR authorization contract");
  requireFragments(modelSource, [
    "operationsCopilotAiAllowed(brief.organizationId)",
    "modelSafeOperationsSnapshot(brief)",
    'response_format: { type: "json_object" }',
    '"No markdown, email addresses, names, case identifiers',
  ], "aggregate-only narration contract");
  requireFragments(clientSource, [
    "brief.organizationId !== props.organizationId",
    "brief.area !== props.area",
    "brief.runId !== props.runId",
    'cache: "no-store"',
    "source evidence",
  ], "client scope and availability contract");
  return {
    apiRoutePaths: [ROUTE],
    pagePaths: [PAGE],
    apiMethods: 2,
    apiCredits: 0,
    pageCredits: 0,
    status: "GAP",
  };
}
