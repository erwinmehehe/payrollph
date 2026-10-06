import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  emailChangeTokens,
  marketingLeads,
  outbox,
  passwordResetTokens,
  rateLimitHits,
  sessions,
  webhookDeliveries,
} from "@/db/schema";

export const RECORD_RETENTION_SCHEDULE = {
  payrollAccountingTax: {
    minimumYears: 5,
    trigger: "Day after the applicable tax-return filing deadline, or actual filing date if filed late",
    authority: "NIRC Section 235 as amended by RA 11976 (EOPT); BIR RR 7-2024",
    records: [
      "payroll registers",
      "payslips supporting payroll accounting",
      "withholding-tax computations",
      "BIR annualization and filing source records",
      "journal/export source records",
      "government contribution source records",
    ],
    disposal:
      "No automatic purge. After the minimum period, an authorized retention review may securely erase or anonymize records only when no tax protest, refund/credit claim, litigation, investigation, or other legal hold remains.",
  },
  employmentLaborRecords: {
    minimumYears: 3,
    trigger: "Date of last entry, execution, or issuance as applicable",
    authority: "Omnibus Rules Implementing the Labor Code, Book III, Rule X, Section 12",
    records: [
      "employment records",
      "time and attendance records",
      "leave and payroll-support records",
      "pay-rate and rest-day history",
    ],
    disposal:
      "Retain longer when the same record is also part of the five-year tax/accounting class or is subject to a legal hold.",
  },
  privacyRequestCaseFiles: {
    reviewAfterYears: 2,
    trigger: "Completion or final rejection of the request",
    authority: "Internal privacy-management policy under DPA/IRR proportionality and retention principles",
    records: [
      "request register",
      "fulfillment evidence",
      "access-export audit evidence",
      "legal-retention assessment",
    ],
    disposal:
      "Review for secure deletion/anonymization after the review period; retain only what remains necessary for legal claims, accountability, or another lawful basis.",
  },
  securityAuditEvidence: {
    reviewAfterYears: 5,
    trigger: "Event creation",
    authority: "Internal security/accountability policy",
    records: ["payroll release audit", "sensitive-action audit", "security/admin audit"],
    disposal:
      "Review rather than automatically purge while the evidence supports retained payroll/tax records, investigations, or legal claims.",
  },
  marketingLeadRecords: {
    reviewAfterYears: 1,
    trigger: "Last activity on the enquiry",
    authority: "Internal data-minimization policy under DPA/IRR proportionality and retention principles",
    records: ["demo requests", "trial-access requests", "payroll-outsourcing enquiries"],
    disposal: "Automatically purge after one year without a recorded update. Active sales records must be updated to reset the retention window.",
  },
  operationalTransientData: {
    trigger: "Fixed operational windows below",
    authority: "Data minimization and operational necessity",
    records: ["sessions", "reset tokens", "rate-limit windows", "outbox", "webhook delivery attempts"],
    disposal: "Automatically purged by purgeExpiredOperationalData after the configured short operational window.",
  },
} as const;

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
  marketingLeadRecords: {
    retentionDaysAfterLastUpdate: 365,
    action: "purge",
    rationale: "Prospect contact data is useful for follow-up but should not remain indefinitely without activity.",
  },
  payrollTaxEmploymentRecords: {
    retention: "record-class-schedule",
    action: "no-automatic-purge",
    rationale:
      "Payroll/tax/accounting records use the five-year tax minimum; employment records use the three-year labor minimum. The longer applicable period and any legal hold control disposal.",
  },
} as const;

const daysAgo = (days: number, now = Date.now()) => new Date(now - days * 86_400_000);
const hoursAgo = (hours: number, now = Date.now()) => new Date(now - hours * 3_600_000);

export async function purgeExpiredOperationalData(now = Date.now()) {
  const authCutoff = daysAgo(RETENTION_POLICY.authenticationArtifacts.retentionDaysAfterExpiry, now);
  const messageCutoff = daysAgo(RETENTION_POLICY.messageDeliveryRecords.retentionDays, now);
  const webhookCutoff = daysAgo(RETENTION_POLICY.webhookDeliveryRecords.retentionDays, now);
  const marketingLeadCutoff = daysAgo(RETENTION_POLICY.marketingLeadRecords.retentionDaysAfterLastUpdate, now);
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

  const deletedMarketingLeads = await db.delete(marketingLeads)
    .where(lt(marketingLeads.updatedAt, marketingLeadCutoff))
    .returning({ id: marketingLeads.id });

  return {
    sessions: deletedSessions.length,
    passwordResetTokens: deletedPasswordTokens.length,
    emailChangeTokens: deletedEmailTokens.length,
    rateLimitWindows: deletedRateHits.length,
    outboxMessages: deletedOutbox.length,
    webhookDeliveries: deletedWebhooks.length,
    marketingLeads: deletedMarketingLeads.length,
  };
}
