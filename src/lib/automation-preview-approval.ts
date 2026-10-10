import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const RECEIPT_VERSION = 1;
export const AUTOMATION_PREVIEW_RECEIPT_TTL_MS = 15 * 60 * 1000;

type DraftIdentity = {
  name: string;
  trigger: string;
  conditions: unknown;
  actions: unknown;
  active: boolean;
};

type PreviewReceiptContext = {
  organizationId: number;
  actorUserId: number;
  sessionId: number;
  sessionToken: string;
  ruleId: number;
  draftVersion: number;
  draftHash: string;
};

type PreviewReceiptPayload = {
  v: 1;
  org: number;
  actor: number;
  session: number;
  rule: number;
  version: number;
  hash: string;
  issuedAt: number;
};

/** Fingerprints exactly the persisted definition, including whether publication activates it. */
export function fingerprintAutomationDraft(draft: DraftIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([
      draft.name,
      draft.trigger,
      draft.conditions,
      draft.actions,
      draft.active,
    ]))
    .digest("hex");
}

function sign(payload: string, sessionToken: string) {
  // Session tokens are random 32-byte, HttpOnly cookie secrets, unique to each login.
  // They are never sent to the client in the receipt or re-used as external API keys.
  return createHmac("sha256", Buffer.from(sessionToken, "hex"))
    .update(payload)
    .digest("base64url");
}

export function issueAutomationPreviewReceipt(
  context: PreviewReceiptContext,
  nowMs = Date.now(),
): string {
  const payload: PreviewReceiptPayload = {
    v: RECEIPT_VERSION,
    org: context.organizationId,
    actor: context.actorUserId,
    session: context.sessionId,
    rule: context.ruleId,
    version: context.draftVersion,
    hash: context.draftHash,
    issuedAt: nowMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return encoded + "." + sign(encoded, context.sessionToken);
}

export function verifyAutomationPreviewReceipt(
  receipt: unknown,
  context: PreviewReceiptContext,
  nowMs = Date.now(),
): boolean {
  if (typeof receipt !== "string" || receipt.length > 1200) return false;
  const pieces = receipt.split(".");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return false;
  const actualSignature = Buffer.from(pieces[1], "base64url");
  const expectedSignature = Buffer.from(sign(pieces[0], context.sessionToken), "base64url");
  if (!actualSignature.length || actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)) return false;

  let payload: PreviewReceiptPayload;
  try {
    payload = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8")) as PreviewReceiptPayload;
  } catch {
    return false;
  }
  if (!payload || typeof payload !== "object") return false;
  if (!Number.isSafeInteger(payload.issuedAt)
    || payload.issuedAt > nowMs
    || nowMs - payload.issuedAt > AUTOMATION_PREVIEW_RECEIPT_TTL_MS) return false;
  return payload.v === RECEIPT_VERSION
    && payload.org === context.organizationId
    && payload.actor === context.actorUserId
    && payload.session === context.sessionId
    && payload.rule === context.ruleId
    && payload.version === context.draftVersion
    && payload.hash === context.draftHash;
}
