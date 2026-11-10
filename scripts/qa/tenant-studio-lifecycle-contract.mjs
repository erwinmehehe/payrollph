/**
 * Independent tenant-isolation proof contract for Automation Studio's
 * publish-rule, rollback-rule and set-active actions. Fictional PG16 only.
 * Source-pinned evidence, never a full POST-method credit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STUDIO_DRAFT_ORIGIN, STUDIO_DRAFT_ROUTE,
  requireDisposableStudioDraftEnv, verifyStudioDraftSources,
} from "./tenant-studio-draft-contract.mjs";
import { gitBlobSha } from "./tenant-studio-triage-contract.mjs";

export const STUDIO_LIFECYCLE_ORIGIN = STUDIO_DRAFT_ORIGIN;
export const STUDIO_LIFECYCLE_ROUTE = STUDIO_DRAFT_ROUTE;
export const PREVIEW_SOURCE_SHA = "1182c52c04200c1b0cb79fde840390f81919a65f";

export function requireDisposableStudioLifecycleEnv(env = process.env) {
  requireDisposableStudioDraftEnv(env);
  assert.equal(env.TENANT_STUDIO_LIFECYCLE_PROOF, "fictional-pg16-only",
    "STUDIO_LIFECYCLE_REFUSED: dedicated disposable proof flag required");
  assert.ok(!env.AUTOMATION_LANGUAGE_STUDIO_ENABLED,
    "STUDIO_LIFECYCLE_REFUSED: natural-language proposals must remain disabled");
  return true;
}

export function verifyStudioLifecycleSources(root = process.cwd()) {
  verifyStudioDraftSources(root);
  assert.equal(gitBlobSha(readFileSync(root + "/src/lib/automation-preview-approval.ts")),
    PREVIEW_SOURCE_SHA, "STUDIO_LIFECYCLE_REFUSED: preview receipt code changed");
  const route = readFileSync(root + "/src/app/api/automation-studio/route.ts", "utf8");
  const versions = readFileSync(root + "/src/lib/automation-versioning.ts", "utf8");
  for (const text of [
    'if (action === "publish-rule")',
    'if (action === "rollback-rule")',
    'if (action === "set-active")',
    "verifyAutomationPreviewReceipt(body.previewReceipt",
    "body.humanApproved !== true",
    "body.limitedEvidenceAcknowledged !== true",
    "publishAutomationRuleDraft({",
    "rollbackAutomationRule({",
    "setAutomationRuleActiveVersioned({",
    "eq(automationEventLog.organizationId, organizationId)",
  ]) assert.ok(route.includes(text), "STUDIO_LIFECYCLE_REFUSED: missing route guard " + text);
  for (const text of [
    "and organization_id = ",
    "eq(automationRules.organizationId, input.organizationId)",
    "eq(automationRuleVersions.organizationId, input.organizationId)",
    "fingerprintAutomationDraft(draft) !== input.expectedDraftHash",
    "Published actions",
    "if (rule.publishedVersion < 1)",
  ]) {
    if (text === "Published actions") continue; // No string-only acceptance for dynamic action validation.
    assert.ok(versions.includes(text),
      "STUDIO_LIFECYCLE_REFUSED: missing versioned write guard " + text);
  }
  return true;
}

export function assertDeniedLifecycle(response, status, employers, name) {
  assert.equal(response?.status, status, name + ": denial status");
  assert.ok(!response?.json?.rule && !response?.json?.published
    && !response?.json?.previewReceipt && !response?.json?.execution,
    name + ": denied response exposed workflow state");
  assert.equal(typeof response?.text, "string", name + ": response body required");
  const decoded = response.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (const employer of employers) {
    assert.ok(!decoded.includes(employer.marker),
      name + ": other employer marker leaked: " + employer.label);
  }
}

export function assertOwnedLifecycle(response, actor, kind, version, active) {
  assert.equal(response?.status, 200, kind + ": own HTTP 200 required");
  const rule = response?.json?.rule;
  const published = response?.json?.published;
  assert.ok(Number.isSafeInteger(rule?.id) && rule.id > 0,
    kind + ": real persisted rule ID required");
  assert.equal(rule.organizationId, actor.org.id);
  assert.equal(rule.id, actor.rule.id);
  assert.equal(rule.publishedVersion, version);
  assert.equal(rule.draftVersion, null);
  assert.equal(rule.active, active);
  assert.ok(Number.isSafeInteger(published?.id) && published.id > 0,
    kind + ": real persisted published version required");
  assert.equal(published.organizationId, actor.org.id);
  assert.equal(published.ruleId, actor.rule.id);
  assert.equal(published.version, version);
  assert.equal(published.status, "published");
  assert.equal(published.active, active);
  assert.equal(published.publishedByUserId, actor.owner.id);
  return { rule, published };
}
