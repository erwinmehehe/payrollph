import { createHash, createPublicKey, verify } from "node:crypto";

export const COMPENSATION_RECOVERY_PURPOSE = "compensation-preledger-retry-v1" as const;

export type CompensationRecoveryApprovalPayload = {
  version: 1;
  purpose: typeof COMPENSATION_RECOVERY_PURPOSE;
  organizationId: number;
  intentId: number;
  reviewerId: string;
  operatorId: string;
  ticketId: string;
  intentUpdatedAt: string;
  issuedAt: string;
  expiresAt: string;
};
export type SignedCompensationRecoveryApproval = CompensationRecoveryApprovalPayload & {
  signature: string;
};

export function compensationRecoveryApprovalMessage(payload: CompensationRecoveryApprovalPayload): string {
  // Signed fields have one unambiguous order and no application-controlled extras.
  return JSON.stringify([
    payload.version, payload.purpose, payload.organizationId, payload.intentId,
    payload.reviewerId, payload.operatorId, payload.ticketId, payload.intentUpdatedAt,
    payload.issuedAt, payload.expiresAt,
  ]);
}

function strictIso(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error("Recovery approval timestamps must be canonical UTC ISO-8601.");
  }
  return timestamp;
}

/**
 * Validate a detached Ed25519 approval signed outside the database operator's
 * environment. Both the approver public key and operator identity MUST be
 * supplied by an independently controlled secrets/identity boundary.
 * Without them, recovery is disabled; a CLI reviewer name is never enough.
 */
export function verifyCompensationRecoveryApproval(
  raw: unknown,
  request: { organizationId: number; intentId: number; now?: Date },
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Signed recovery approval is required.");
  }
  const record = raw as Record<string, unknown>;
  const keys = [
    "version", "purpose", "organizationId", "intentId", "reviewerId", "operatorId",
    "ticketId", "intentUpdatedAt", "issuedAt", "expiresAt", "signature",
  ];
  if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))) {
    throw new Error("Recovery approval contains missing or unexpected fields.");
  }
  const approval = raw as SignedCompensationRecoveryApproval;
  if (approval.version !== 1 || approval.purpose !== COMPENSATION_RECOVERY_PURPOSE
    || !Number.isSafeInteger(request.organizationId) || request.organizationId <= 0
    || !Number.isSafeInteger(request.intentId) || request.intentId <= 0
    || approval.organizationId !== request.organizationId || approval.intentId !== request.intentId) {
    throw new Error("Recovery approval does not match requested employer and intent.");
  }
  const principal = /^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,119}$/;
  const ticket = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{3,119}$/;
  if (typeof approval.reviewerId !== "string" || !principal.test(approval.reviewerId)
    || typeof approval.operatorId !== "string" || !principal.test(approval.operatorId)
    || approval.reviewerId === approval.operatorId
    || typeof approval.ticketId !== "string" || !ticket.test(approval.ticketId)) {
    throw new Error("Recovery requires separate named reviewer and operator identities and a change ticket.");
  }
  const expectedOperator = process.env.COMPENSATION_RECOVERY_OPERATOR_ID;
  if (!expectedOperator || expectedOperator !== approval.operatorId) {
    throw new Error("Recovery operator identity is not authorized by the runtime boundary.");
  }
  for (const field of ["intentUpdatedAt", "issuedAt", "expiresAt"] as const) {
    if (typeof approval[field] !== "string") throw new Error("Recovery timestamp is missing.");
  }
  strictIso(approval.intentUpdatedAt);
  const issuedAt = strictIso(approval.issuedAt);
  const expiresAt = strictIso(approval.expiresAt);
  const now = (request.now ?? new Date()).getTime();
  if (!Number.isFinite(now) || issuedAt > now + 30_000 || expiresAt < now
    || expiresAt <= issuedAt || expiresAt - issuedAt > 10 * 60_000) {
    throw new Error("Recovery approval expired or violates the ten-minute issuance window.");
  }
  if (typeof approval.signature !== "string" || !/^[a-zA-Z0-9_-]{86}$/.test(approval.signature)) {
    throw new Error("Recovery approval has no valid Ed25519 signature encoding.");
  }
  const publicKeyPem = process.env.COMPENSATION_RECOVERY_APPROVER_PUBLIC_KEY;
  if (!publicKeyPem) throw new Error("Recovery approver verification key is not configured; recovery disabled.");
  let approved = false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    approved = publicKey.asymmetricKeyType === "ed25519" && verify(
      null,
      Buffer.from(compensationRecoveryApprovalMessage(approval), "utf8"),
      publicKey,
      Buffer.from(approval.signature, "base64url"),
    );
  } catch {
    approved = false;
  }
  if (!approved) throw new Error("Independent recovery approval signature is invalid.");
  return {
    reviewerId: approval.reviewerId,
    operatorId: approval.operatorId,
    ticketId: approval.ticketId,
    intentUpdatedAt: approval.intentUpdatedAt,
    approvalDigest: createHash("sha256").update(Buffer.from(approval.signature, "base64url")).digest("hex"),
  };
}
