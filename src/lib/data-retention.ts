import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  emailChangeTokens,
  outbox,
  passwordResetTokens,
  rateLimitHits,
  sessions,
  webhookDeliveries,
} from "@/db/schema";

export const RETENTION_POLICY = {
  authenticationArtifacts: {
    retentionDaysAfterExpiry: 30,
    action: "purge",
    rationale: "Short-lived security artifacts are not payroll records.",
  },
  rateLimitCounters: {
    retentionHours: 1,
    action: "purge",
    rationale: "Only the active abuse-prevention window is required.",
  },
  messageDeliveryRecords: {
    retentionDays: 180,
    action: "purge-completed",
    rationale: "Retain enough delivery history for support while limiting message-body retention.",
  },
  webhookDeliveryRecords: {
    retentionDays: 365,
    action: "purge-completed",
    rationale: "Operational evidence is retained longer than transient message delivery data.",
  },
  payrollTaxEmploymentRecords: {
    retention: "legal-retention-policy",
    action: "no-automatic-purge",
    rationale:
      "Payroll, tax, employment, government filing, final-pay and audit records may be subject to statutory retention or legal hold. They require a configured legal basis before destruction.",
  },
} as const;

const daysAgo = (days: number, now = Date.now()) => new Date(now - days * 86_400_000);
const hoursAgo = (hours: number, now = Date.now()) => new Date(now - hours * 3_600_000);

export async function purgeExpiredOperationalData(now = Date.now()) {
  const authCutoff = daysAgo(RETENTION_POLICY.authenticationArtifacts.retentionDaysAfterExpiry, now);
  const messageCutoff = daysAgo(RETENTION_POLICY.messageDeliveryRecords.retentionDays, now);
  const webhookCutoff = daysAgo(RETENTION_POLICY.webhookDeliveryRecords.retentionDays, now);
  const rateCutoff = hoursAgo(RETENTION_POLICY.rateLimitCounters.retentionHours, now);

  const deletedSessions = await db.delete(sessions).where(or(
    lt(sessions.expiresAt, authCutoff),
    and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, authCutoff)),
  )).returning({ id: sessions.id });

  const deletedPasswordTokens = await db.delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, authCutoff))
    .returning({ id: passwordResetTokens.id });

  const deletedEmailTokens = await db.delete(emailChangeTokens)
    .where(lt(emailChangeTokens.expiresAt, authCutoff))
    .returning({ id: emailChangeTokens.id });

  const deletedRateHits = await db.delete(rateLimitHits)
    .where(lt(rateLimitHits.windowStart, rateCutoff))
    .returning({ id: rateLimitHits.id });

  const deletedOutbox = await db.delete(outbox).where(and(
    lt(outbox.createdAt, messageCutoff),
    inArray(outbox.status, ["sent", "failed"]),
  )).returning({ id: outbox.id });

  const deletedWebhooks = await db.delete(webhookDeliveries).where(and(
    lt(webhookDeliveries.createdAt, webhookCutoff),
    inArray(webhookDeliveries.status, ["delivered", "failed"]),
  )).returning({ id: webhookDeliveries.id });

  return {
    sessions: deletedSessions.length,
    passwordResetTokens: deletedPasswordTokens.length,
    emailChangeTokens: deletedEmailTokens.length,
    rateLimitWindows: deletedRateHits.length,
    outboxMessages: deletedOutbox.length,
    webhookDeliveries: deletedWebhooks.length,
  };
}
