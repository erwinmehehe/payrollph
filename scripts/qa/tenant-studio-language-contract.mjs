/**
 * Strict synthetic multi-employer receipt contract for Automation Studio's
 * model-disabled "draft-from-language" and "save-language-draft" POST actions.
 * No external model or method-level credit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STUDIO_DRAFT_ORIGIN, STUDIO_DRAFT_ROUTE,
  requireDisposableStudioDraftEnv, verifyStudioDraftSources,
} from "./tenant-studio-draft-contract.mjs";
import { gitBlobSha } from "./tenant-studio-triage-contract.mjs";

export const ORIGIN = STUDIO_DRAFT_ORIGIN;
export const ROUTE = STUDIO_DRAFT_ROUTE;
export const PROMPT =
  "When a new employee is hired, create an onboarding checklist and send them a welcome email.";
export const SOURCE_BLOBS = Object.freeze({
  "src/lib/automation-language-release.ts": "1a1e12c39ecdf671810219e1f168c0c3d2b80c77",
  "src/lib/automation-language-draft.ts": "30240aeccaccf5b08ac062206bbae15b51629ffd",
  "src/lib/automation-language-proposal-receipt.ts": "5912340d0950eef2428780350bdb97014999ffe3",
});

export function requireDisposableStudioLanguageEnv(env = process.env) {
  requireDisposableStudioDraftEnv(env);
  assert.equal(env.TENANT_STUDIO_LANGUAGE_PROOF, "fictional-pg16-only",
    "STUDIO_LANGUAGE_REFUSED: dedicated disposable profile required");
  assert.equal(env.AUTOMATION_LANGUAGE_ACCEPTANCE_MODE, "synthetic-postgres-only",
    "STUDIO_LANGUAGE_REFUSED: only synthetic language acceptance may be enabled");
  assert.equal(env.AUTOMATION_LANGUAGE_STUDIO_ENABLED, undefined,
    "STUDIO_LANGUAGE_REFUSED: production language feature switch must be absent");
  assert.equal(env.OPENAI_AUTOMATION_DRAFT_ENABLED, "false",
    "STUDIO_LANGUAGE_REFUSED: external model must remain disabled");
  assert.ok(!env.OPENAI_API_KEY, "STUDIO_LANGUAGE_REFUSED: provider key prohibited");
  return true;
}

export function verifyStudioLanguageSources(root = process.cwd()) {
  verifyStudioDraftSources(root);
  for (const [path, sha] of Object.entries(SOURCE_BLOBS)) {
    assert.equal(gitBlobSha(readFileSync(root + "/" + path)), sha,
      "STUDIO_LANGUAGE_REFUSED: source changed: " + path);
  }
  const route = readFileSync(root + "/src/app/api/automation-studio/route.ts", "utf8");
  const release = readFileSync(root + "/src/lib/automation-language-release.ts", "utf8");
  for (const text of [
    'if (action === "draft-from-language")',
    'if (action === "save-language-draft")',
    "!automationLanguageStudioEnabled()",
    "automationModelAllowedForOrganization(organizationId)",
    "verifyLanguageProposalReceipt(body.proposalReceipt",
    "issueLanguageProposalReceipt({",
    "active: false",
    "enforceSensitiveActionRateLimit(request",
  ]) assert.ok(route.includes(text), "STUDIO_LANGUAGE_REFUSED: missing route gate " + text);
  for (const text of [
    'process.env.AUTOMATION_LANGUAGE_STUDIO_ENABLED',
    'process.env.AUTOMATION_LANGUAGE_ACCEPTANCE_MODE',
    'process.env.OPENAI_AUTOMATION_DRAFT_ENABLED',
    'process.env.OPENAI_API_KEY',
  ]) assert.ok(release.includes(text), "STUDIO_LANGUAGE_REFUSED: missing release guard " + text);
  return true;
}

export function assertDeniedLanguage(response, status, employers, label) {
  assert.equal(response?.status, status, label + ": expected denial status");
  assert.equal(response?.json?.rule, undefined, label + ": denied rule disclosed");
  assert.equal(response?.json?.draft, undefined, label + ": denied draft disclosed");
  assert.equal(response?.json?.proposalReceipt, undefined, label + ": signed receipt leaked");
  assert.equal(typeof response?.text, "string", label + ": response body required");
  const decoded = response.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (const employer of employers) {
    assert.ok(!decoded.includes(employer.marker),
      label + ": employer private marker leaked " + employer.label);
  }
}

export function assertOwnProposal(response) {
  assert.equal(response?.status, 200, "Real model-disabled own language proposal required");
  assert.equal(response?.json?.source, "approved-template",
    "No external AI model is allowed, even for valid own proposals");
  assert.equal(response?.json?.validation?.valid, true);
  assert.equal(response?.json?.draft?.trigger, "employee.hired");
  assert.ok(Array.isArray(response?.json?.draft?.actions));
  assert.equal(response.json.draft.actions.length, 2);
  assert.ok(typeof response.json.proposalReceipt === "string"
    && response.json.proposalReceipt.length > 40,
    "Valid signed proposal receipt required");
  return { draft: response.json.draft, receipt: response.json.proposalReceipt };
}

export function assertOwnedLanguageSave(response, actor) {
  assert.equal(response?.status, 201, "Signed owned draft HTTP 201 required");
  assert.equal(response?.json?.created, true);
  const rule = response?.json?.rule, draft = response?.json?.draft;
  assert.ok(Number.isSafeInteger(rule?.id) && rule.id > 0);
  assert.ok(Number.isSafeInteger(draft?.id) && draft.id > 0);
  assert.equal(rule.organizationId, actor.org.id);
  assert.equal(draft.organizationId, actor.org.id);
  assert.equal(draft.ruleId, rule.id);
  assert.equal(rule.createdByUserId, actor.owner.id);
  assert.equal(draft.createdByUserId, actor.owner.id);
  assert.equal(rule.active, false);
  assert.equal(rule.publishedVersion, 0);
  assert.equal(rule.draftVersion, 1);
  assert.equal(draft.status, "draft");
  assert.equal(draft.version, 1);
  assert.equal(draft.active, false);
  return { rule, draft };
}
