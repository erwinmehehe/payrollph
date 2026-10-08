import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  COMPENSATION_RECOVERY_PURPOSE,
  compensationRecoveryApprovalMessage,
  verifyCompensationRecoveryApproval,
} from "../src/lib/compensation-recovery-approval";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const now = new Date("2026-10-09T04:00:00.000Z");
const org = 7, intent = 21;
function issue(overrides: Record<string, unknown> = {}) {
  const payload = {
    version: 1 as const,
    purpose: COMPENSATION_RECOVERY_PURPOSE,
    organizationId: org,
    intentId: intent,
    reviewerId: "reviewer.qa",
    operatorId: "operator.qa",
    ticketId: "CHANGE-1234",
    intentUpdatedAt: "2026-10-09T03:45:00.000Z",
    issuedAt: "2026-10-09T03:58:00.000Z",
    expiresAt: "2026-10-09T04:05:00.000Z",
    ...overrides,
  };
  return { ...payload, signature: sign(null, Buffer.from(compensationRecoveryApprovalMessage(payload)), privateKey).toString("base64url") };
}
function environment() {
  process.env.COMPENSATION_RECOVERY_APPROVER_PUBLIC_KEY = publicPem;
  process.env.COMPENSATION_RECOVERY_OPERATOR_ID = "operator.qa";
}
test("exact-state independently signed recovery approval is verifiable", () => {
  environment();
  const result = verifyCompensationRecoveryApproval(issue(), { organizationId: org, intentId: intent, now });
  assert.equal(result.reviewerId, "reviewer.qa");
  assert.equal(result.operatorId, "operator.qa");
  assert.equal(result.ticketId, "CHANGE-1234");
  assert.match(result.approvalDigest, /^[a-f0-9]{64}$/);
});
test("free-text reviewer or unsigned approval never grants recovery", () => {
  environment();
  assert.throws(() => verifyCompensationRecoveryApproval({ reviewerId: "fake" }, { organizationId: org, intentId: intent, now }), /missing or unexpected/i);
  assert.throws(() => verifyCompensationRecoveryApproval({ ...issue(), signature: "" }, { organizationId: org, intentId: intent, now }), /signature/i);
});
test("signature cannot be copied to another tenant, intent, operator or ticket", () => {
  environment();
  for (const edit of [
    { organizationId: 8 }, { intentId: 22 }, { operatorId: "another.operator" },
    { reviewerId: "another.reviewer" }, { ticketId: "CHANGE-9999" },
  ]) {
    assert.throws(() => verifyCompensationRecoveryApproval({ ...issue(), ...edit }, { organizationId: org, intentId: intent, now }));
  }
});
test("expired, overlong or future-dated approvals fail closed", () => {
  environment();
  for (const time of [
    { issuedAt: "2026-10-09T03:40:00.000Z", expiresAt: "2026-10-09T03:50:00.000Z" },
    { issuedAt: "2026-10-09T03:00:00.000Z", expiresAt: "2026-10-09T04:05:00.000Z" },
    { issuedAt: "2026-10-09T04:02:00.000Z", expiresAt: "2026-10-09T04:05:00.000Z" },
  ]) assert.throws(() => verifyCompensationRecoveryApproval(issue(time), { organizationId: org, intentId: intent, now }), /issuance window/i);
});
test("recovery disabled without separate configured approver key or runtime identity", () => {
  environment();
  const signed = issue();
  delete process.env.COMPENSATION_RECOVERY_APPROVER_PUBLIC_KEY;
  assert.throws(() => verifyCompensationRecoveryApproval(signed, { organizationId: org, intentId: intent, now }), /not configured/i);
  environment();
  delete process.env.COMPENSATION_RECOVERY_OPERATOR_ID;
  assert.throws(() => verifyCompensationRecoveryApproval(signed, { organizationId: org, intentId: intent, now }), /not authorized/i);
  environment();
});
