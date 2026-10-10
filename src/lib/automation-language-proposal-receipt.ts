import { createHmac, timingSafeEqual } from "node:crypto";
import { fingerprintAutomationDraft } from "@/lib/automation-preview-approval";
import type { TypedAutomationLanguageDraft } from "@/lib/automation-language-draft";

const RECEIPT_VERSION = 1;
const RECEIPT_PURPOSE = "language-draft-save";
export const LANGUAGE_PROPOSAL_RECEIPT_TTL_MS = 15 * 60_000;
export type LanguageProposalSource = "model" | "approved-template";

type ProposalContext = {
  organizationId: number;
  actorUserId: number;
  sessionId: number;
  sessionToken: string;
  draftHash: string;
};

type ProposalReceiptPayload = {
  v: 1;
  purpose: typeof RECEIPT_PURPOSE;
  org: number;
  actor: number;
  session: number;
  hash: string;
  source: LanguageProposalSource;
  issuedAt: number;
};

/** This fingerprint always includes active=false, which is enforced at the server save boundary. */
export function fingerprintLanguageProposal(draft: TypedAutomationLanguageDraft) {
  return fingerprintAutomationDraft({
    name: draft.name,
    trigger: draft.trigger,
    conditions: draft.conditions,
    actions: draft.actions,
    active: false,
  });
}

function sign(encoded: string, sessionToken: string) {
  return createHmac("sha256", Buffer.from(sessionToken, "hex"))
    .update(RECEIPT_PURPOSE + ":" + encoded)
    .digest("base64url");
}

export function issueLanguageProposalReceipt(
  context: ProposalContext,
  source: LanguageProposalSource,
  nowMs = Date.now(),
) {
  const payload: ProposalReceiptPayload = {
    v: RECEIPT_VERSION,
    purpose: RECEIPT_PURPOSE,
    org: context.organizationId,
    actor: context.actorUserId,
    session: context.sessionId,
    hash: context.draftHash,
    source,
    issuedAt: nowMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return encoded + "." + sign(encoded, context.sessionToken);
}

/** Returns signed provenance only for the original proposal and authenticated session. */
export function verifyLanguageProposalReceipt(
  receipt: unknown,
  context: ProposalContext,
  nowMs = Date.now(),
): LanguageProposalSource | null {
  if (typeof receipt !== "string" || receipt.length > 1200) return null;
  const pieces = receipt.split(".");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(pieces[0]) || !/^[A-Za-z0-9_-]+$/.test(pieces[1])) return null;

  const expected = Buffer.from(sign(pieces[0], context.sessionToken), "base64url");
  const actual = Buffer.from(pieces[1], "base64url");
  if (!actual.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  let payload: ProposalReceiptPayload;
  try {
    payload = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8")) as ProposalReceiptPayload;
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object"
    || payload.v !== RECEIPT_VERSION
    || payload.purpose !== RECEIPT_PURPOSE
    || !Number.isSafeInteger(payload.issuedAt)
    || payload.issuedAt > nowMs
    || nowMs - payload.issuedAt > LANGUAGE_PROPOSAL_RECEIPT_TTL_MS
    || payload.org !== context.organizationId
    || payload.actor !== context.actorUserId
    || payload.session !== context.sessionId
    || payload.hash !== context.draftHash
    || (payload.source !== "model" && payload.source !== "approved-template")) {
    return null;
  }

  return payload.source;
}
