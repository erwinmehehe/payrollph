/**
 * Synthetic execution/recovery side of Automation Studio POST.
 * This is source-pinned, sub-action evidence only. No method credit.
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
export const SOURCE_BLOBS = Object.freeze({
  "src/lib/automation-operational-cases.ts": "5355d830524f54e6d47dd551c9d7bc5e73649f52",
  "src/lib/automation-language-release.ts": "1a1e12c39ecdf671810219e1f168c0c3d2b80c77",
});

export function requireDisposableStudioExecutionEnv(env = process.env) {
  requireDisposableStudioDraftEnv(env);
  assert.equal(env.TENANT_STUDIO_EXECUTION_PROOF, "fictional-pg16-only",
    "STUDIO_EXECUTION_REFUSED: dedicated proof flag required");
  assert.equal(env.AUTOMATION_LANGUAGE_STUDIO_ENABLED, "false",
    "STUDIO_EXECUTION_REFUSED: language/model lane must be OFF");
  assert.equal(env.OPENAI_AUTOMATION_DRAFT_ENABLED, "false",
    "STUDIO_EXECUTION_REFUSED: external model must be OFF");
  return true;
}

export function verifyStudioExecutionSources(root = process.cwd()) {
  verifyStudioDraftSources(root);
  for (const [path, blob] of Object.entries(SOURCE_BLOBS)) {
    assert.equal(gitBlobSha(readFileSync(root + "/" + path)), blob,
      "STUDIO_EXECUTION_REFUSED: source changed without review: " + path);
  }
  const route = readFileSync(root + "/src/app/api/automation-studio/route.ts", "utf8");
  const automation = readFileSync(root + "/src/lib/automation.ts", "utf8");
  for (const item of [
    'if (action === "quarantine-execution-step")',
    'if (action === "triage-operational-case")',
    'if (action === "retry-execution-step")',
    'if (action === "replay-execution")',
    'if (action === "draft-from-language")',
    'if (action === "save-language-draft")',
    "eq(automationExecutions.organizationId, organizationId)",
    "eq(automationOperationalCases.organizationId, organizationId)",
    "enforceSensitiveActionRateLimit(request",
    "!automationLanguageStudioEnabled()",
  ]) assert.ok(route.includes(item), "STUDIO_EXECUTION_REFUSED: missing route gate " + item);
  for (const item of [
    "eq(automationExecutions.organizationId, input.organizationId)",
    "SAFE_FAILED_STEP_RETRY_ACTIONS",
    "SAFE_REPLAY_EXECUTION_ACTIONS",
    "quarantines.some((letter) => letter.status !== \"acknowledged\")",
  ]) assert.ok(automation.includes(item), "STUDIO_EXECUTION_REFUSED: missing recovery guard " + item);
  return true;
}

export function assertDeniedExecution(response, status, employers, description) {
  assert.equal(response?.status, status, description + ": expected denied status");
  assert.equal(response?.json?.execution, undefined, description + ": execution disclosed");
  assert.equal(response?.json?.operationalCase, undefined, description + ": case disclosed");
  assert.equal(response?.json?.proposalReceipt, undefined, description + ": receipt disclosed");
  assert.equal(typeof response?.text, "string", description + ": text required");
  const decoded = response.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (const employer of employers) {
    assert.ok(!decoded.includes(employer.marker),
      description + ": tenant private marker disclosed " + employer.label);
  }
}

export function assertOwnedCase(response, actor, expectedStatus, created) {
  assert.equal(response?.status, expectedStatus === "open" && created ? 201 : 200);
  const c = response?.json?.operationalCase;
  assert.ok(Number.isSafeInteger(c?.id) && c.id > 0);
  assert.equal(c.organizationId, actor.org.id);
  assert.equal(c.caseType, "execution_dead_letter");
  assert.equal(c.sourceId, actor.failed.id);
  assert.equal(c.executionId, actor.failed.id);
  assert.equal(c.stepIndex, 0);
  assert.equal(c.status, expectedStatus);
  if (created !== undefined) {
    assert.equal(response?.json?.created, created);
    assert.equal(response?.json?.automationWasReplayed, false);
  } else {
    assert.equal(response?.json?.sourceMutation, false);
    assert.equal(response?.json?.executionStatusUnchanged, true);
  }
  return c;
}

export function assertOwnRecovery(response, actor, action) {
  assert.equal(response?.status, action === "replay" ? 201 : 200);
  const e = response?.json?.execution;
  assert.ok(Number.isSafeInteger(e?.id) && e.id > 0,
    action + ": real execution ID required");
  assert.equal(e.organizationId, actor.org.id);
  assert.equal(e.ruleId, actor.rule.id);
  assert.equal(e.employeeId, actor.worker.id);
  assert.equal(e.status, "completed");
  if (action === "replay") assert.notEqual(e.id, actor.replaySource.id);
  else assert.equal(e.id, actor.failed.id);
  assert.ok(Array.isArray(e.result) && e.result.at(-1)?.status === "completed");
  return e;
}
