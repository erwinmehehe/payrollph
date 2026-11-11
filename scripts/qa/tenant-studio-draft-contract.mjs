/**
 * Separate Automation Studio draft-write tenant evidence, zero method credits.
 * No runtime API, provider, payroll, scheduler or production configuration changes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STUDIO_TRIAGE_ROUTE_SHA, gitBlobSha, requireDisposableStudioTriageEnv } from "./tenant-studio-triage-contract.mjs";

export const STUDIO_DRAFT_ORIGIN = "http://127.0.0.1:3000";
export const STUDIO_DRAFT_ROUTE = "/api/automation-studio";
export const STUDIO_DRAFT_TEMPLATE = "people-new-hire-core-onboarding";
export const SOURCE_BLOBS = Object.freeze({
  "src/app/api/automation-studio/route.ts": STUDIO_TRIAGE_ROUTE_SHA,
  "src/lib/automation-versioning.ts": "02de9020858887818b70bd940d6b287d1c73e9bf",
  "src/lib/automation-templates.ts": "f6cd21b7a09fc575345c92f49edcf8b80767952d",
  "src/lib/automation.ts": "ce2c8e8feee4554c85f7739b73f2fa0325b81306",
  "src/lib/automation-recovery-scope.ts": "ff3dddff0e7ddea20a7be24792d84503a540202e",
});

export function requireDisposableStudioDraftEnv(env = process.env) {
  // Keep every original DB/secret/worker/provider safety interlock.
  requireDisposableStudioTriageEnv(env);
  assert.equal(env.TENANT_STUDIO_DRAFT_PROOF, "fictional-pg16-only",
    "STUDIO_DRAFT_REFUSED: a dedicated fictional-only proof flag is required");
  assert.equal(env.NODE_ENV, "production",
    "STUDIO_DRAFT_REFUSED: production-mode Next localhost required");
  return true;
}

export function verifyStudioDraftSources(root = process.cwd()) {
  for (const [path, sha] of Object.entries(SOURCE_BLOBS)) {
    assert.equal(gitBlobSha(readFileSync(root + "/" + path)), sha,
      "STUDIO_DRAFT_REFUSED: source changed; re-review " + path);
  }
  const route = readFileSync(root + "/src/app/api/automation-studio/route.ts", "utf8");
  const versions = readFileSync(root + "/src/lib/automation-versioning.ts", "utf8");
  for (const needle of [
    "enforceSameOriginMutation(request)", "await getSessionUser()",
    "assertStudioAdmin(user.id, organizationId)", "requireSensitiveActionMfa(user)",
    'if (action === "save-rule")', 'if (action === "create-from-template")',
    "await saveAutomationRuleDraft({", "validateConnectorActions(organizationId, actions)",
    "validateDynamicGroupReferences(organizationId, conditions, actions)",
  ]) assert.ok(route.includes(needle), "STUDIO_DRAFT_REFUSED: missing route gate " + needle);
  for (const needle of [
    "where id = ${input.ruleId}", "and organization_id = ${input.organizationId}",
    "eq(automationRules.organizationId, input.organizationId)",
    "eq(automationRuleVersions.organizationId, input.organizationId)",
    "active: false", "publishedVersion: 0", "status: \"draft\"",
  ]) assert.ok(versions.includes(needle), "STUDIO_DRAFT_REFUSED: missing versioning guard " + needle);
  return true;
}

export function assertDeniedDraft(response, expectedStatus, employers, label) {
  assert.equal(response?.status, expectedStatus, label + ": exact denial status");
  assert.equal(response?.json?.rule, undefined, label + ": denied rule disclosed");
  assert.equal(response?.json?.draft, undefined, label + ": denied draft disclosed");
  assert.equal(typeof response?.text, "string", label + ": response body required");
  for (const employer of employers) {
    const raw = response.text.replace(/\\u([0-9a-fA-F]{4})/g,
      (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    assert.ok(!raw.includes(employer.marker),
      label + ": denied response disclosed employer marker " + employer.label);
  }
}

export function assertOwnedDraft(response, actor, kind, expectedName) {
  assert.equal(response?.status, 201, kind + ": own HTTP 201 required");
  assert.equal(response?.json?.created, true, kind + ": persisted new rule required");
  const rule = response.json?.rule, draft = response.json?.draft;
  assert.ok(Number.isSafeInteger(rule?.id) && rule.id > 0, kind + ": persisted rule ID required");
  assert.ok(Number.isSafeInteger(draft?.id) && draft.id > 0, kind + ": persisted draft ID required");
  assert.equal(rule.organizationId, actor.org.id);
  assert.equal(draft.organizationId, actor.org.id);
  assert.equal(draft.ruleId, rule.id);
  assert.equal(draft.version, 1);
  assert.equal(draft.status, "draft");
  assert.equal(draft.name, expectedName);
  assert.equal(rule.name, expectedName);
  assert.equal(rule.createdByUserId, actor.owner.id);
  assert.equal(rule.publishedVersion, 0, kind + ": draft must never be published");
  assert.equal(rule.draftVersion, 1);
  assert.equal(rule.active, false, kind + ": draft must never activate a live rule");
  return { rule, draft };
}
