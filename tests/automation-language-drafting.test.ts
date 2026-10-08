import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const compiler = read("src/lib/automation-language-draft.ts");
const api = read("src/app/api/automation-studio/route.ts");
const ui = read("src/components/automation-studio-panel.tsx");
const versioning = read("src/lib/automation-versioning.ts");

test("language drafting uses typed, allow-listed Studio primitives and rejects privileged actions", () => {
  assert.ok(compiler.includes("LANGUAGE_DRAFT_ACTIONS"));
  assert.ok(compiler.includes("validateNaturalLanguageDraft"));
  assert.ok(compiler.includes("validAutomationConditions"));
  assert.ok(compiler.includes("normalizeAutomationActions"));
  assert.ok(compiler.includes("validateAutomationActionTrigger"));
  assert.ok(compiler.includes("LIVE_TRIGGERS"));
  assert.ok(compiler.includes("ACTION_KEYS"));
  assert.ok(compiler.includes("Language drafting cannot choose arbitrary email recipients."));
  for (const dangerous of ['"request_payroll_adjustment"', '"deactivate_access"', '"revoke_sessions"', '"webhook"', '"assign_permission_set"']) {
    const start = compiler.indexOf("export const LANGUAGE_DRAFT_ACTIONS");
    const end = compiler.indexOf("] as const;", start);
    assert.equal(compiler.slice(start, end).includes(dangerous), false, dangerous);
  }
});

test("language proposal is non-mutating; persistence uses versioned draft lane", () => {
  // Anchor at the actual request-handler block, not the earlier rollout
  // guard that mentions both action names in one condition.
  const generateStart = api.indexOf('  if (action === "draft-from-language") {');
  const saveStart = api.indexOf('  if (action === "save-language-draft") {', generateStart);
  assert.ok(generateStart >= 0 && saveStart > generateStart, "Language action handlers must exist");
  const languageBranch = api.slice(generateStart, saveStart);
  assert.ok(languageBranch.includes("draftAutomationFromLanguage"));
  assert.equal(languageBranch.includes("saveAutomationRuleDraft("), false);
  assert.equal(languageBranch.includes("publishAutomationRuleDraft("), false);
  assert.equal(languageBranch.includes("simulateAutomationImpact("), false);
  assert.ok(api.includes('action === "save-rule"'));
  assert.ok(api.includes('action === "publish-rule"'));
  assert.ok(versioning.includes('active: false'));
});

test("natural-language Studio UI requires human review and gated publish", () => {
  assert.ok(ui.includes("NATURAL-LANGUAGE DRAFTING"));
  assert.ok(ui.includes('action: "draft-from-language"'));
  assert.ok(ui.includes("JSON.stringify(languageProposal.draft, null, 2)"));
  assert.ok(ui.includes('action: "save-language-draft"'));
  assert.ok(ui.includes("proposalReceipt: languageProposal.proposalReceipt"));
  assert.ok(api.includes('action === "save-language-draft"'));
  const signedSave = api.slice(api.indexOf('action === "save-language-draft"'), api.indexOf('action === "create-from-template"'));
  assert.ok(signedSave.includes("validateNaturalLanguageDraft(body.draft)"));
  assert.ok(signedSave.includes("verifyLanguageProposalReceipt"));
  assert.ok(signedSave.includes("active: false"));
  assert.equal(signedSave.includes("publishAutomationRuleDraft("), false);
  assert.ok(ui.includes("Save inactive draft"));
  assert.ok(ui.includes("setLanguageProposal(null)"));
  assert.ok(ui.includes("run Impact Preview for its exact version"));
  assert.ok(ui.includes("Approve and publish"));
  assert.ok(ui.includes("disabled={!previewSafe}"));
});

test("drafting never changes scope or silently maps high-risk request to a template", () => {
  assert.ok(compiler.includes("No drafting model is configured"));
  assert.ok(compiler.includes("return null;"));
  assert.ok(compiler.includes("UNSAFE_DIRECT_REQUEST"));
  assert.ok(compiler.includes("Never drop a scope qualifier"));
  assert.ok(compiler.includes("Do not invent or infer IDs"));
  assert.ok(compiler.includes("No workflow has been saved or executed"));
});
