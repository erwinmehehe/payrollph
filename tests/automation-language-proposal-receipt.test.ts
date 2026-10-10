import assert from "node:assert/strict";
import test from "node:test";
import {
  LANGUAGE_PROPOSAL_RECEIPT_TTL_MS,
  fingerprintLanguageProposal,
  issueLanguageProposalReceipt,
  verifyLanguageProposalReceipt,
} from "../src/lib/automation-language-proposal-receipt";
import type { TypedAutomationLanguageDraft } from "../src/lib/automation-language-draft";

const draft: TypedAutomationLanguageDraft = {
  name: "New hire checklist",
  trigger: "employee.hired",
  conditions: { version: 1, all: [], any: [] },
  actions: [{ type: "create_task", title: "Review documents", owner: "People Ops" }],
};
const context = {
  organizationId: 10,
  actorUserId: 20,
  sessionId: 30,
  sessionToken: "ab".repeat(32),
  draftHash: fingerprintLanguageProposal(draft),
};

test("proposal signing binds the specific name, conditions, actions, company, actor and session", () => {
  const now = 1_790_000_000_000;
  const proof = issueLanguageProposalReceipt(context, "model", now);
  assert.equal(verifyLanguageProposalReceipt(proof, context, now + 500), "model");
  const templateProof = issueLanguageProposalReceipt(context, "approved-template", now);
  assert.equal(verifyLanguageProposalReceipt(templateProof, context, now + 500), "approved-template");

  const changedName = fingerprintLanguageProposal({ ...draft, name: "Different workflow" });
  const changedConditions = fingerprintLanguageProposal({
    ...draft,
    conditions: { version: 1, all: [{ field: "department", operator: "eq", value: "Finance" }], any: [] },
  });
  const changedAction = fingerprintLanguageProposal({
    ...draft,
    actions: [{ type: "create_task", title: "Different action", owner: "People Ops" }],
  });
  for (const draftHash of [changedName, changedConditions, changedAction]) {
    assert.equal(verifyLanguageProposalReceipt(proof, { ...context, draftHash }, now + 500), null);
  }
  for (const altered of [
    { organizationId: context.organizationId + 1 },
    { actorUserId: context.actorUserId + 1 },
    { sessionId: context.sessionId + 1 },
    { sessionToken: "cd".repeat(32) },
  ]) {
    assert.equal(verifyLanguageProposalReceipt(proof, { ...context, ...altered }, now + 500), null);
  }
});

test("proposal receipt fails closed on tampering, expiry and invalid data", () => {
  const now = 1_790_000_000_000;
  const proof = issueLanguageProposalReceipt(context, "model", now);
  assert.equal(verifyLanguageProposalReceipt(proof, context, now + LANGUAGE_PROPOSAL_RECEIPT_TTL_MS), "model");
  assert.equal(verifyLanguageProposalReceipt(proof, context, now + LANGUAGE_PROPOSAL_RECEIPT_TTL_MS + 1), null);
  assert.equal(verifyLanguageProposalReceipt(proof, context, now - 1), null);
  const [message, mac] = proof.split(".");
  assert.equal(verifyLanguageProposalReceipt(message + ".ab" + mac, context, now), null);
  assert.equal(verifyLanguageProposalReceipt("x." + mac, context, now), null);
  assert.equal(verifyLanguageProposalReceipt(message + ".invalid$$", context, now), null);
  assert.equal(verifyLanguageProposalReceipt(null, context, now), null);
  assert.equal(verifyLanguageProposalReceipt("x".repeat(1500), context, now), null);
});

test("signed language proposal save is an inactive versioned draft, not a publish path", async () => {
  const fs = await import("node:fs");
  const api = fs.readFileSync("src/app/api/automation-studio/route.ts", "utf8");
  const ui = fs.readFileSync("src/components/automation-studio-panel.tsx", "utf8");
  const start = api.indexOf('action === "save-language-draft"');
  const end = api.indexOf('action === "create-from-template"', start);
  assert.ok(start > 0 && end > start);
  const block = api.slice(start, end);
  assert.ok(block.includes("validateNaturalLanguageDraft(body.draft)"));
  assert.ok(block.includes("verifyLanguageProposalReceipt(body.proposalReceipt"));
  assert.ok(block.includes("saveAutomationRuleDraft({"));
  assert.ok(block.includes("active: false"));
  assert.equal(block.includes("publishAutomationRuleDraft"), false);
  assert.ok(api.includes("issueLanguageProposalReceipt({"));
  assert.ok(ui.includes('action: "save-language-draft"'));
  assert.ok(ui.includes("proposalReceipt: languageProposal.proposalReceipt"));
});
