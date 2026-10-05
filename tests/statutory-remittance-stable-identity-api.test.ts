import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const remittanceRoute = readFileSync(
  "src/app/api/compliance/statutory-remittances/route.ts",
  "utf8",
);
const closeRoute = readFileSync(
  "src/app/api/compliance/remittance-month-close/route.ts",
  "utf8",
);
const independence = readFileSync(
  "src/lib/statutory-remittance-independence.ts",
  "utf8",
);

test("remittance evidence stores stable user IDs alongside display names", () => {
  assert.ok(schema.includes('paymentRecordedByUserId: integer("payment_recorded_by_user_id")'));
  assert.ok(schema.includes('reconciledByUserId: integer("reconciled_by_user_id")'));
  assert.ok(schema.includes('confirmedByUserId: integer("confirmed_by_user_id")'));
  assert.ok(remittanceRoute.includes("paymentRecordedByUserId: user.id"));
  assert.ok(remittanceRoute.includes("confirmedByUserId: user.id"));
  assert.ok(remittanceRoute.includes("reconciledByUserId: user.id"));
});

test("month close uses stable actor IDs and includes active payment-proof uploader", () => {
  assert.ok(closeRoute.includes("buildEvidenceActorIdentity"));
  assert.ok(closeRoute.includes("certifierConflictsWithEvidence"));
  assert.ok(closeRoute.includes("uploadedByUserId: statutoryRemittancePaymentEvidence.uploadedByUserId"));
  assert.ok(closeRoute.includes("userId: evidence.uploadedByUserId"));
  assert.ok(closeRoute.includes("certifierUserId: user.id"));
});

test("legacy actor names are only a fallback when stable IDs are absent", () => {
  assert.ok(independence.includes("if (Number.isInteger(actor.userId)"));
  assert.ok(independence.includes("legacyNames.add(name)"));
  assert.ok(independence.includes("input.evidence.userIds.has(input.certifierUserId)"));
  assert.ok(independence.includes("input.evidence.legacyNames.has(name)"));
});

test("private actor identity sets are not returned by the month-close GET API", () => {
  assert.ok(closeRoute.includes("evidenceActorIdentity: _evidenceActorIdentity"));
  assert.ok(closeRoute.includes("...publicResult"));
});

test("reconciliation rollback clears stable reconciler identity with the display name", () => {
  assert.ok(remittanceRoute.includes("reconciledByUserId: null"));
  assert.ok(remittanceRoute.includes("reconciledBy: null"));
});
