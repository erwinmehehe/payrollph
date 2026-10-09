import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_PREVIEW_RECEIPT_TTL_MS,
  fingerprintAutomationDraft,
  issueAutomationPreviewReceipt,
  verifyAutomationPreviewReceipt,
} from "../src/lib/automation-preview-approval";

const draft = {
  name: "Timesheet reminders",
  trigger: "timesheet.cutoff_approaching",
  conditions: { version: 1, all: [], any: [] },
  actions: [{ type: "request_approval", title: "Review", approver: "Payroll", detail: "Confirm" }],
  active: false,
};
const ctx = {
  organizationId: 42,
  actorUserId: 21,
  sessionId: 8,
  sessionToken: "da".repeat(32),
  ruleId: 37,
  draftVersion: 2,
  draftHash: fingerprintAutomationDraft(draft),
};

test("Impact Preview receipt binds the exact draft, organization, admin and session", () => {
  const now = 1_790_000_000_000;
  const receipt = issueAutomationPreviewReceipt(ctx, now);
  assert.equal(verifyAutomationPreviewReceipt(receipt, ctx, now + 500), true);
  assert.equal(verifyAutomationPreviewReceipt(receipt, { ...ctx, organizationId: 43 }, now + 500), false);
  assert.equal(verifyAutomationPreviewReceipt(receipt, { ...ctx, actorUserId: 99 }, now + 500), false);
  assert.equal(verifyAutomationPreviewReceipt(receipt, { ...ctx, sessionId: 9 }, now + 500), false);
  assert.equal(verifyAutomationPreviewReceipt(receipt, { ...ctx, sessionToken: "ab".repeat(32) }, now + 500), false);
  assert.equal(verifyAutomationPreviewReceipt(receipt, { ...ctx, ruleId: 38 }, now + 500), false);
  assert.equal(verifyAutomationPreviewReceipt(receipt, { ...ctx, draftVersion: 3 }, now + 500), false);
  assert.equal(verifyAutomationPreviewReceipt(receipt, { ...ctx, draftHash: fingerprintAutomationDraft({ ...draft, active: true }) }, now + 500), false);
});

test("Impact Preview receipt fails closed on expiry, signature tampering and future timestamps", () => {
  const now = 1_790_000_000_000;
  const receipt = issueAutomationPreviewReceipt(ctx, now);
  assert.equal(verifyAutomationPreviewReceipt(receipt, ctx, now + AUTOMATION_PREVIEW_RECEIPT_TTL_MS), true);
  assert.equal(verifyAutomationPreviewReceipt(receipt, ctx, now + AUTOMATION_PREVIEW_RECEIPT_TTL_MS + 1), false);
  assert.equal(verifyAutomationPreviewReceipt(receipt, ctx, now - 1), false);
  assert.equal(verifyAutomationPreviewReceipt(receipt + "tamper", ctx, now), false);
  const [encodedPayload, signature] = receipt.split(".");
  const corruptedSignature = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.equal(verifyAutomationPreviewReceipt(encodedPayload + "." + corruptedSignature, ctx, now), false);
  assert.equal(verifyAutomationPreviewReceipt("invalid", ctx, now), false);
  assert.equal(verifyAutomationPreviewReceipt(null, ctx, now), false);
  assert.equal(verifyAutomationPreviewReceipt("a".repeat(1201), ctx, now), false);
});

test("publish route consumes server-verified receipt and rechecks the draft inside the transaction", async () => {
  const fs = await import("node:fs");
  const route = fs.readFileSync("src/app/api/automation-studio/route.ts", "utf8");
  const versioning = fs.readFileSync("src/lib/automation-versioning.ts", "utf8");
  const ui = fs.readFileSync("src/components/automation-studio-panel.tsx", "utf8");
  assert.ok(route.includes("issueAutomationPreviewReceipt"));
  assert.ok(route.includes("verifyAutomationPreviewReceipt(body.previewReceipt"));
  assert.ok(route.includes("body.humanApproved !== true"));
  assert.ok(route.includes("expectedDraftHash: draftHash"));
  assert.ok(versioning.includes("fingerprintAutomationDraft(draft) !== input.expectedDraftHash"));
  assert.ok(ui.includes("previewReceipt: currentPreview.previewReceipt"));
  assert.ok(ui.includes("humanApproved: true"));
  assert.ok(ui.includes("window.confirm("));
  assert.ok(route.includes("impactPreview.authoritativeEvents === 0 && body.limitedEvidenceAcknowledged !== true"));
  assert.ok(ui.includes("limitedEvidenceAcknowledged: limitedEvidence"));
  assert.ok(ui.includes("No authoritative events were available"));
  assert.ok(ui.includes('"Limited evidence"'));
});
